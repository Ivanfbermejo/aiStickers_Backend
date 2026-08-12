/**
 * Validate the URL form emitted by Sentry for a DSN.
 *
 * The public key is intentionally stored in URL.username. URL.password is
 * never valid for a Sentry DSN because it would expose an unexpected secret.
 */
export function isValidSentryDsn(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (!parsed.hostname || !parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;

  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  return pathSegments.length > 0 && /^\d+$/.test(pathSegments.at(-1));
}
