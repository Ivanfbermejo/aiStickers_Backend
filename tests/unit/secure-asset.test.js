import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { resolve as dnsResolve } from 'node:dns/promises';

vi.mock('node:dns/promises', () => ({
  default: { resolve: vi.fn() },
  resolve: vi.fn()
}));

import {
  isInternalUrl,
  parseDataUri,
  validateImageBuffer,
  validateUrlSafety,
  downloadSecureUrl,
  MAX_DOWNLOAD_BYTES,
  MAX_IMAGE_PIXELS
} from '../../src/application/services/secure-asset.service.js';

async function makePngBuffer(width = 32, height = 32) {
  return sharp({
    create: { width, height, channels: 3, background: 'blue' }
  })
    .png()
    .toBuffer();
}

function makeDataUri(buffer, mimeType = 'image/png') {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function mockResponse({ status = 200, headers = {}, chunks = [] } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key) => headers[key.toLowerCase()]
    },
    body: {
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          next: () => {
            if (index < chunks.length) {
              return Promise.resolve({ value: chunks[index++], done: false });
            }
            return Promise.resolve({ done: true });
          }
        };
      },
      destroy: vi.fn()
    }
  };
}

function makeMockFetch(response) {
  return vi.fn(() => Promise.resolve(response));
}

function makeHangingFetch() {
  return vi.fn((_, { signal }) =>
    new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    })
  );
}

describe('Secure asset service', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isInternalUrl', () => {
    it('accepts data: URIs', () => {
      expect(isInternalUrl('data:image/png;base64,abc')).toBe(true);
    });

    it('accepts internal upload paths', () => {
      expect(isInternalUrl('/uploads/file.webp')).toBe(true);
    });

    it('rejects external https URLs', () => {
      expect(isInternalUrl('https://example.com/image.png')).toBe(false);
    });
  });

  describe('parseDataUri', () => {
    it('decodes a valid image data URI', async () => {
      const buffer = await makePngBuffer();
      const uri = makeDataUri(buffer, 'image/png');
      const result = parseDataUri(uri);
      expect(result.mimeType).toBe('image/png');
      expect(result.buffer.equals(buffer)).toBe(true);
    });

    it('rejects a non-image data URI', () => {
      const uri = 'data:text/plain;base64,SGVsbG8=';
      expect(() => parseDataUri(uri)).toThrow('Only image data URIs are allowed');
    });

    it('rejects an unsupported image subtype', () => {
      const uri = 'data:image/svg+xml;base64,PHN2Zz4=';
      expect(() => parseDataUri(uri)).toThrow('Unsupported image format');
    });

    it('rejects a base64 data URI exceeding the byte limit', () => {
      const big = Buffer.alloc(MAX_DOWNLOAD_BYTES + 1);
      const uri = makeDataUri(big, 'image/png');
      expect(() => parseDataUri(uri)).toThrow('exceeds maximum allowed size');
    });
  });

  describe('validateImageBuffer', () => {
    it('accepts a valid PNG', async () => {
      const buffer = await makePngBuffer(64, 64);
      const meta = await validateImageBuffer(buffer);
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(64);
      expect(meta.height).toBe(64);
    });

    it('rejects an empty buffer', async () => {
      await expect(validateImageBuffer(Buffer.from(''))).rejects.toThrow('Empty or invalid image buffer');
    });

    it('rejects random bytes', async () => {
      await expect(validateImageBuffer(Buffer.from('not an image'))).rejects.toThrow('Unrecognized or unsupported image format');
    });

    it('rejects a buffer with mismatched magic bytes', async () => {
      const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).jpeg().toBuffer();
      const renamed = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), jpeg.slice(4)]);
      await expect(validateImageBuffer(renamed)).rejects.toThrow();
    });

    it('rejects images exceeding the maximum pixel count', async () => {
      const side = Math.floor(Math.sqrt(MAX_IMAGE_PIXELS)) + 1;
      const buffer = await makePngBuffer(side, side);
      await expect(validateImageBuffer(buffer)).rejects.toThrow('dimensions exceed the allowed limit');
    });
  });

  describe('validateUrlSafety', () => {
    it('blocks non-HTTPS schemes', async () => {
      await expect(validateUrlSafety('http://example.com/x.png', { allowlist: ['example.com'] }))
        .rejects.toThrow('Only HTTPS URLs are allowed');
    });

    it('blocks URLs with credentials', async () => {
      await expect(validateUrlSafety('https://user:pass@example.com/x.png', { allowlist: ['example.com'] }))
        .rejects.toThrow('credentials');
    });

    it('blocks hosts not in the allowlist', async () => {
      dnsResolve.mockResolvedValue(['1.2.3.4']);
      await expect(validateUrlSafety('https://other.example.com/x.png', { allowlist: ['allowed.example.com'] }))
        .rejects.toThrow('Host is not in the allowlist');
    });

    it('blocks 127.0.0.1', async () => {
      await expect(validateUrlSafety('https://127.0.0.1/x.png', { allowlist: ['127.0.0.1'] }))
        .rejects.toThrow('Private or internal addresses are not allowed');
    });

    it('blocks localhost', async () => {
      await expect(validateUrlSafety('https://localhost/x.png', { allowlist: ['localhost'] }))
        .rejects.toThrow('Private or internal addresses are not allowed');
    });

    it('blocks ::1', async () => {
      await expect(validateUrlSafety('https://[::1]/x.png', { allowlist: ['::1'] }))
        .rejects.toThrow('Private or internal addresses are not allowed');
    });

    it.each([
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254'
    ])('blocks private/link-local IP %s', async (ip) => {
      await expect(validateUrlSafety(`https://${ip}/x.png`, { allowlist: [ip] }))
        .rejects.toThrow('Private or internal addresses are not allowed');
    });

    it('blocks a public hostname that resolves to a private IP (DNS rebinding)', async () => {
      dnsResolve.mockResolvedValue(['127.0.0.1']);
      await expect(validateUrlSafety('https://public.example.com/x.png', { allowlist: ['public.example.com'] }))
        .rejects.toThrow('Private or internal addresses are not allowed');
    });

    it('blocks a hostname with no DNS records', async () => {
      dnsResolve.mockRejectedValue(new Error('ENOTFOUND'));
      await expect(validateUrlSafety('https://missing.example.com/x.png', { allowlist: ['missing.example.com'] }))
        .rejects.toThrow('Could not resolve hostname');
    });

    it('accepts an allowlisted host that resolves to a public IP', async () => {
      dnsResolve.mockResolvedValue(['1.2.3.4']);
      await expect(validateUrlSafety('https://allowed.example.com/x.png', { allowlist: ['allowed.example.com'] }))
        .resolves.toBeUndefined();
    });
  });

  describe('downloadSecureUrl', () => {
    it('downloads and returns a valid image from an allowlisted host', async () => {
      const buffer = await makePngBuffer();
      const fetchImpl = makeMockFetch(mockResponse({ chunks: [buffer] }));
      dnsResolve.mockResolvedValue(['1.2.3.4']);

      const result = await downloadSecureUrl('https://allowed.example.com/x.png', {
        allowlist: ['allowed.example.com'],
        fetchImpl
      });

      expect(result.equals(buffer)).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('rejects a localhost URL even when the fetch would succeed', async () => {
      const fetchImpl = makeMockFetch(mockResponse());
      await expect(downloadSecureUrl('https://127.0.0.1/x.png', { allowlist: ['127.0.0.1'], fetchImpl }))
        .rejects.toThrow('Private or internal addresses are not allowed');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects a redirect to a private address', async () => {
      const fetchImpl = makeMockFetch(
        mockResponse({ status: 302, headers: { location: 'https://127.0.0.1/private.png' } })
      );
      dnsResolve.mockResolvedValue(['1.2.3.4']);

      await expect(downloadSecureUrl('https://allowed.example.com/x.png', {
        allowlist: ['allowed.example.com'],
        fetchImpl
      })).rejects.toThrow('Private or internal addresses are not allowed');
    });

    it('times out on a slow response', async () => {
      const fetchImpl = makeHangingFetch();
      dnsResolve.mockResolvedValue(['1.2.3.4']);

      await expect(downloadSecureUrl('https://allowed.example.com/x.png', {
        allowlist: ['allowed.example.com'],
        fetchImpl,
        timeoutMs: 20
      })).rejects.toThrow('timed out or was aborted');
    });

    it('aborts when the response exceeds the byte limit', async () => {
      const chunk = Buffer.alloc(6 * 1024 * 1024);
      const fetchImpl = makeMockFetch(mockResponse({ chunks: [chunk, chunk] }));
      dnsResolve.mockResolvedValue(['1.2.3.4']);

      await expect(downloadSecureUrl('https://allowed.example.com/x.png', {
        allowlist: ['allowed.example.com'],
        fetchImpl,
        maxBytes: 10 * 1024 * 1024
      })).rejects.toThrow('exceeds maximum');
    });

    it('rejects a fake MIME type with invalid content', async () => {
      const fetchImpl = makeMockFetch(
        mockResponse({
          chunks: [Buffer.from('this is not an image')],
          headers: { 'content-type': 'image/png' }
        })
      );
      dnsResolve.mockResolvedValue(['1.2.3.4']);

      const buffer = await downloadSecureUrl('https://allowed.example.com/x.png', {
        allowlist: ['allowed.example.com'],
        fetchImpl
      });
      await expect(validateImageBuffer(buffer)).rejects.toThrow('Unrecognized or unsupported image format');
    });
  });
});
