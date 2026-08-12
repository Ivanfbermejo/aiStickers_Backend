/**
 * Secure Asset Service
 *
 * Hardens external image downloads and uploaded buffers against SSRF, malicious
 * URLs, oversized payloads, decompression bombs and format spoofing.
 *
 * Rules enforced:
 *   - Only HTTPS URLs (plus internal data:/upload path references).
 *   - No credentials embedded in the URL.
 *   - Hostname must be in an explicit allowlist.
 *   - DNS resolution is checked; loopback, RFC1918, link-local, multicast and
 *     IPv6 equivalents are rejected.
 *   - Redirects are followed manually and re-validated at every hop (max 2).
 *   - Total request timeout 10 s and maximum response size 10 MB via streaming.
 *   - Magic bytes are verified before trusting Sharp metadata.
 *   - Image dimensions and total pixel count are capped.
 *   - data: URIs are decoded and size-limited.
 */

import { resolve as dnsResolve } from 'node:dns/promises';
import net from 'node:net';
import { URL } from 'node:url';
import fetch from 'node-fetch';
import sharp from 'sharp';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 2;
const DEFAULT_MAX_PIXELS = 4096 * 4096;

const ALLOWED_IMAGE_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const TRUSTED_PROVIDER_HOSTS = new Set(['replicate.delivery', 'replicate.com']);

export const MAX_DOWNLOAD_BYTES = DEFAULT_MAX_BYTES;
export const MAX_IMAGE_PIXELS = DEFAULT_MAX_PIXELS;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87A_MAGIC = Buffer.from('GIF87a');
const GIF89A_MAGIC = Buffer.from('GIF89a');

function detectMagicFormat(buffer) {
  if (buffer.length >= 4 && buffer.slice(0, 4).equals(PNG_MAGIC)) return 'png';
  if (buffer.length >= 3 && buffer.slice(0, 3).equals(JPEG_MAGIC)) return 'jpg';
  if (buffer.length >= 6) {
    const head = buffer.slice(0, 6);
    if (head.equals(GIF87A_MAGIC) || head.equals(GIF89A_MAGIC)) return 'gif';
  }
  if (buffer.length >= 12) {
    const riff = buffer.slice(0, 4).toString('ascii');
    const webp = buffer.slice(8, 12).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
  }
  return null;
}

function isPrivateOrReservedAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts;
    // 0.0.0.0/8, 127.0.0.0/8, 10.0.0.0/8
    if (a === 0 || a === 127 || a === 10) return true;
    // 100.64.0.0/10
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 link-local
    if (a === 169 && b === 254) return true;
    // 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24, 198.18.0.0/15,
    // 198.51.100.0/24, 203.0.113.0/24
    if (a === 192 && b === 0 && parts[2] === 0) return true;
    if (a === 192 && b === 0 && parts[2] === 2) return true;
    if (a === 192 && b === 88 && parts[2] === 99) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && parts[2] === 100) return true;
    if (a === 203 && b === 0 && parts[2] === 113) return true;
    // Multicast 224.0.0.0/4 and reserved/experimental 240.0.0.0/4
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    // Loopback
    if (lower === '::1') return true;
    // Link-local fe80::/10
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // Unique local fc00::/7
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Multicast ff00::/8
    if (lower.startsWith('ff')) return true;
    // IPv4-mapped IPv6 addresses
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice(7);
      if (mapped) return isPrivateOrReservedAddress(mapped);
    }
    return false;
  }

  return false;
}

function isAllowedHost(hostname, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;
  for (const entry of allowlist) {
    const normalized = String(entry).toLowerCase();
    const host = hostname.toLowerCase();
    if (normalized === host) return true;
    if (normalized.startsWith('*.') && host.endsWith(normalized.slice(1)) && host !== normalized.slice(1)) {
      return true;
    }
  }
  return false;
}

export function isInternalUrl(urlString) {
  if (typeof urlString !== 'string') return false;
  if (urlString.startsWith('data:')) return true;
  if (urlString.startsWith('/uploads/')) return true;
  if (urlString.startsWith('/api/v1/assets/')) return true;
  return false;
}

export function parseDataUri(uri, maxBytes = DEFAULT_MAX_BYTES) {
  if (!uri.startsWith('data:')) {
    throw new Error('Invalid data URI');
  }
  const match = /^data:([^;,]+)(;base64)?,(.*)$/.exec(uri);
  if (!match || !match[2]) {
    throw new Error('Only base64-encoded data URIs are supported');
  }
  const mimeType = match[1].trim().toLowerCase();
  if (!mimeType.startsWith('image/')) {
    throw new Error('Only image data URIs are allowed');
  }
  const format = mimeType.split('/')[1];
  if (!ALLOWED_IMAGE_FORMATS.has(format)) {
    throw new Error('Unsupported image format in data URI');
  }
  const base64 = match[3];
  const approxDecoded = Math.floor(base64.length * 3 / 4);
  if (approxDecoded > maxBytes) {
    throw new Error('Data URI exceeds maximum allowed size');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > maxBytes) {
    throw new Error('Data URI exceeds maximum allowed size');
  }
  return { mimeType, buffer };
}

export async function validateImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Empty or invalid image buffer');
  }
  const magicFormat = detectMagicFormat(buffer);
  if (!magicFormat) {
    throw new Error('Unrecognized or unsupported image format');
  }

  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new Error('Failed to parse image metadata');
  }

  const format = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
  if (!format || !ALLOWED_IMAGE_FORMATS.has(format)) {
    throw new Error('Unsupported image format');
  }
  if (magicFormat === 'jpg' && format !== 'jpg') {
    throw new Error('Image format does not match declared content');
  }
  if (magicFormat !== 'jpg' && magicFormat !== format) {
    throw new Error('Image format does not match declared content');
  }

  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height || width * height > DEFAULT_MAX_PIXELS) {
    throw new Error('Image dimensions exceed the allowed limit');
  }

  return { format, width, height, sizeBytes: buffer.length };
}

export async function validateUrlSafety(urlString, { allowlist = [] } = {}) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs containing credentials are not allowed');
  }

  let hostname = parsed.hostname;
  // URL.host/hostname keeps IPv6 literals wrapped in brackets; strip them for IP checks.
  const ipAddress = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  const lowerHostname = hostname.toLowerCase();
  if (lowerHostname === 'localhost' || lowerHostname.endsWith('.localhost')) {
    throw new Error('Private or internal addresses are not allowed');
  }

  const hostForAllowlist = ipAddress === hostname ? hostname : ipAddress;

  if (net.isIP(ipAddress)) {
    if (isPrivateOrReservedAddress(ipAddress)) {
      throw new Error('Private or internal addresses are not allowed');
    }
  } else {
    const [aRecords, aaaaRecords] = await Promise.all([
      dnsResolve(ipAddress, 'A').catch(() => []),
      dnsResolve(ipAddress, 'AAAA').catch(() => [])
    ]);
    const ips = [...aRecords, ...aaaaRecords];
    if (ips.length === 0) {
      throw new Error('Could not resolve hostname');
    }
    for (const ip of ips) {
      if (isPrivateOrReservedAddress(ip)) {
        throw new Error('Private or internal addresses are not allowed');
      }
    }
  }

  if (!isAllowedHost(hostForAllowlist, allowlist)) {
    throw new Error('Host is not in the allowlist');
  }
}

async function fetchWithLimits(urlString, { maxBytes, timeoutMs, maxRedirects, allowlist, redirectCount, fetchImpl, signal }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  signal?.addEventListener('abort', abortFromParent, { once: true });
  if (signal?.aborted) controller.abort();
  let response;

  try {
    response = await fetchImpl(urlString, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'Accept': 'image/*' }
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.toLowerCase().includes('abort')) {
      throw new Error('Download timed out or was aborted');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }

  if (response.status >= 300 && response.status < 400) {
    if (redirectCount >= maxRedirects) {
      throw new Error('Too many redirects');
    }
    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Redirect without location header');
    }
    const nextUrl = new URL(location, urlString).href;
    await validateUrlSafety(nextUrl, { allowlist });
    return fetchWithLimits(nextUrl, { maxBytes, timeoutMs, maxRedirects, allowlist, redirectCount: redirectCount + 1, fetchImpl, signal });
  }

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error('Response exceeds maximum allowed size');
  }

  if (!response.body) {
    throw new Error('Empty response body');
  }

  const chunks = [];
  let size = 0;
  const stream = response.body;

  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > maxBytes) {
        if (typeof stream.destroy === 'function') {
          stream.destroy();
        }
        throw new Error('Download exceeds maximum allowed size');
      }
      chunks.push(chunk);
    }
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('abort')) {
      throw new Error('Download timed out or was aborted');
    }
    throw err;
  }

  return Buffer.concat(chunks);
}

export async function downloadSecureUrl(urlString, options = {}) {
  const {
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    allowlist = [],
    fetchImpl = fetch,
    signal
  } = options;

  await validateUrlSafety(urlString, { allowlist });
  return fetchWithLimits(urlString, {
    maxBytes,
    timeoutMs,
    maxRedirects,
    allowlist,
    redirectCount: 0,
    fetchImpl,
    signal
  });
}

export async function downloadSecureImage(urlString, options = {}) {
  const buffer = await downloadSecureUrl(urlString, options);
  const metadata = await validateImageBuffer(buffer);
  return { buffer, metadata };
}

export async function validateDataUriImage(uri, maxBytes = DEFAULT_MAX_BYTES) {
  const { buffer } = parseDataUri(uri, maxBytes);
  const metadata = await validateImageBuffer(buffer);
  return { buffer, metadata };
}

export async function validateClientImageReference(urlString, { allowlist = [] } = {}) {
  if (urlString.startsWith('data:')) {
    await validateDataUriImage(urlString);
    return;
  }
  if (isInternalUrl(urlString)) {
    return;
  }
  await validateUrlSafety(urlString, { allowlist });
}

export function getTrustedProviderHosts() {
  return Array.from(TRUSTED_PROVIDER_HOSTS);
}
