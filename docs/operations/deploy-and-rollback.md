# Deploy and rollback runbook

## Deploy

1. Ensure the target environment has passed all CI gates:
   - `npm test`
   - `npm audit --omit=dev`
   - `node scripts/security-scan.js`
   - `node scripts/api-contract-check.js`
   - `node scripts/smoke-start.js`
   - Docker compose config and build succeed.
2. Review the diff since the last deploy and confirm the intended API contract
   has not changed.
3. Update environment variables only through the deployment platform; never
   commit secrets.
4. Apply database migrations before starting new containers:
   - `prisma migrate deploy`
5. Start the new version with the new healthcheck on `/health/ready`.
6. Wait for `/health/ready` to return `200` with all critical components ready
   (postgres, redis, storage, queue when enabled).
7. Verify a small sample of production traffic with a known `x-request-id` and
   confirm logs do not contain PII or secrets.

## Rollback

1. Stop accepting new traffic at the load balancer / ingress for the failing
   version.
2. Keep existing containers running until in-flight requests and queued jobs
   finish, respecting `SHUTDOWN_TIMEOUT_MS`.
3. Re-deploy the previous known-good image.
4. Confirm `/health/ready` is `200` and queue backlog is draining.
5. If a database migration introduced an incompatible change, restore from the
   latest verified backup following [Backup and restore](./backup-restore.md).
