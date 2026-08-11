# Backup and restore

## Objectives (provisional)

| Objective | Default | Owner approval required |
|-----------|---------|-------------------------|
| RPO (Recovery Point Objective) | 24 hours | Yes for production |
| RTO (Recovery Time Objective) | 4 hours | Yes for production |

Adjust the backup schedule to meet these targets.

## Backup

```bash
# Optional: encrypt with BACKUP_ENCRYPTION_KEY in production
node scripts/backup.js --output ./backups/staging
```

- Reads credentials only from environment variables (`DATABASE_URL`, S3 keys).
- Never prints `DATABASE_URL`, passwords, or encryption keys.
- Production backups require:
  - `BACKUP_ENCRYPTION_KEY` set (AES-256-CBC via OpenSSL).
  - S3 versioning enabled on the target bucket (`BACKUP_S3_VERSIONING=true`).
- Output includes:
  - `db.dump` (PostgreSQL custom-format dump, produced by `pg_dump -Fc`; never gzipped).
  - `assets.tar.gz` (local assets) or a mirror of S3 objects.
  - `manifest.json` with file sizes and SHA-256 checksums for every file.
  - If `BACKUP_ENCRYPTION_KEY` is set, `db.dump` and `assets.tar.gz` are
    encrypted to `db.dump.enc` / `assets.tar.gz.enc` and the plaintext files
    are removed.

## Restore

```bash
RESTORE_TARGET_ENV=staging node scripts/restore.js \
  --backup ./backups/staging/<timestamp> \
  --target-db postgresql://... \
  --target-assets ./restored-assets
```

- `RESTORE_TARGET_ENV` is required and must be exactly `test` or `staging`.
  Production restores are not supported and have no bypass.
- Verifies `manifest.json` and the SHA-256 of every backup file before doing
  anything else; throws if the manifest is missing or any checksum mismatches.
- Verifies the PostgreSQL custom format with `pg_restore --list`, validates the
  asset tar archive, and rejects any non-empty target database or asset
  destination before modifying either destination.
- Restores from the custom-format dump (`db.dump` or `db.dump.enc`) using
  `pg_restore`. Encrypted dumps/asset archives are decrypted to a temporary
  file first, then the temporary plaintext file is deleted once restore
  completes (including on failure).
- Never drops a schema or overwrites/deletes existing asset objects. Local
  assets are staged and promoted only after extraction succeeds.
- Produces `restore-report.json` with counts, balances, ledger sums, purchase
  totals, and asset object verification, computed via PrismaClient so
  table/column names always match the schema. No PII is included.

## Validation

A backup is not considered valid until the restore drill completes successfully.
Run the drill with ephemeral PostgreSQL and MinIO using the integration test:

```bash
npm test -- tests/integration/restore-drill.test.js
```

## Responsibilities

- Engineering owns backup script correctness and the restore drill.
- SRE owns backup scheduling, encryption key management, and off-site retention.
- The service owner approves RPO/RTO before production.
