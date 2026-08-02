import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Generate a random identifier.
 * @param {number} [byteLength] - If provided, returns a hex string of this many bytes.
 *                                Otherwise returns a UUID.
 */
export function randomId(byteLength) {
  if (byteLength) {
    return randomBytes(byteLength).toString('hex');
  }
  return randomUUID();
}
