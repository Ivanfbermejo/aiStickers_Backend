const SHA256_HEX = /^[0-9a-f]{64}$/i;

/**
 * Resolve the T07 private-object request shape used by HMAC v2 clients.
 * The hash is checked against verified storage metadata and ownership is
 * checked by AssetService; HMAC is only an anti-abuse signal.
 */
export async function resolveClientAsset({
  assetService,
  ownerId,
  objectKey,
  hash,
  reference,
  buffer,
  declaredMimeType,
  allowlist
}) {
  if (objectKey !== undefined || hash !== undefined) {
    if (typeof objectKey !== 'string' || objectKey.trim() === '' || !SHA256_HEX.test(String(hash || ''))) {
      throw new Error('objectKey and hash are required for private assets');
    }

    const verified = await assetService.readVerifiedObject({
      key: objectKey,
      ownerId
    });
    if (verified.metadata.hash.toLowerCase() !== hash.toLowerCase()) {
      throw new Error('Asset hash does not match stored object');
    }

    return {
      key: objectKey,
      format: verified.format,
      ownerId,
      hash: verified.metadata.hash,
      sizeBytes: verified.metadata.sizeBytes,
      mimeType: verified.metadata.mimeType,
      width: verified.metadata.width,
      height: verified.metadata.height
    };
  }

  return assetService.ingestClientAsset({
    reference,
    buffer,
    declaredMimeType,
    ownerId,
    allowlist
  });
}
