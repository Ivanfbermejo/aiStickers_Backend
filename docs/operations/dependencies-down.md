# PostgreSQL / Redis / storage down runbook

## Symptoms

- `/health/ready` returns `503` for one or more components.
- `dependency_up{name="<component>"}` is `0`.
- Rate limits or HMAC nonce replay checks start failing open (`503` for
  fail-closed scopes).

## PostgreSQL

1. Verify connectivity from the container: `pg_isready -h <host>`.
2. Check disk space, connection pool saturation, and slow queries.
3. If the database is unreachable, the HTTP process returns `503` for readiness
   but remains alive on `/health/live` so the orchestrator can decide whether
   to restart or fail over.
4. Restore from the latest verified backup if data loss occurred; see
   [Backup and restore](./backup-restore.md).

## Redis

1. Verify `redis-cli ping` from the container.
2. Redis is shared by rate limits, HMAC nonce replay, and BullMQ. An outage
   affects auth resilience and queue transport.
3. If Redis is unavailable, fail-closed rate limits return `503`; fail-open
   scopes continue without rate limiting.
4. Restore Redis persistence volume or rebuild from queue reconcilers after the
   instance recovers.

## Object storage (S3 / MinIO)

1. Check storage connectivity via `/health/ready`.
2. Verify bucket permissions, credentials, and lifecycle policies.
3. If storage is down, signed-asset requests fail; existing cached objects may
   still be served by CDN.
4. For prolonged outages, restore assets from the latest verified backup.
