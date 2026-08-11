# Deploy and rollback runbook

## Deploy

The release process is manual. CI builds and exercises the image but does not
deploy it or enable traffic automatically. Use the following order for every
release:

1. Create and verify a backup, including its restore manifest and object
   storage checks.
2. Run `npm run production:preflight` with the production environment injected
   by the deployment platform. This is a non-destructive configuration check;
   it must not receive credentials through committed files.
3. Download the image using an immutable `IMAGE_TAG`. Do not use `latest`.
4. Run the separate migration container:
   `docker compose -f compose.production.example.yml run --rm migrate`.
5. Start the worker and wait for its container healthcheck.
6. Start the backend and wait for `/health/ready` to return `200` with
   PostgreSQL, Redis, S3 and the queue ready when enabled.
7. Run the functional smoke checks, including `/health/live` and the protected
   or disabled `/metrics` endpoint.
8. Enable traffic only after all checks pass. Verify a small sample of traffic
   with a known `x-request-id` and confirm logs contain no PII or secrets.

The migration container is intentionally separate from backend startup. A
failed migration stops the release before either application process is
started.

## Rollback

1. Stop accepting new traffic at the load balancer / ingress for the failing
   version.
2. Keep existing containers running until in-flight requests and queued jobs
   finish, respecting `SHUTDOWN_TIMEOUT_MS`.
3. Download and deploy the previous known-good immutable image tag. Run its
   worker and backend using the normal healthchecks.
4. Confirm `/health/ready` is `200`, then verify that the queue backlog is
   draining before enabling traffic again.
5. Migrations that are incompatible with the previous application version are
   never reverted automatically. Roll back the image only when the current
   schema remains compatible with that image; otherwise follow the verified
   backup procedure in [Backup and restore](./backup-restore.md) and perform a
   reviewed, explicit data/schema recovery.
