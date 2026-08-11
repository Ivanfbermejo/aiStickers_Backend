# Queue and DLQ runbook

## Symptoms

- `queue_jobs{queue="generation",state="failed"}` or `stalled` is rising.
- `job_outcomes_total{status="failed"}` is increasing.
- Generation jobs remain `processing` longer than `GENERATION_QUEUE_TIMEOUT_MS`.

## Investigation

1. Check queue counts via `/metrics` (requires bearer token) or the worker logs
   filtered by `correlationId`.
2. List DLQ entries in Redis (queue name `{prefix}:generation-dlq`).
3. Identify failure category from `ai_errors_total` labels (`provider`,
   `category`).

## Remediation

1. **Transient provider failures**: DLQ jobs will be retried by the reconciler.
2. **Stuck jobs**: The worker uses `withAbortTimeout`; stalled jobs are moved to
   failed and then DLQ.
3. **Replay a DLQ job**:
   ```bash
   node scripts/replay-generation-dlq.js --job-id <jobId>
   ```
4. **Drain / cleanup**: Stop producers, let workers finish, then restart.
5. If a job is failing due to invalid user input, delete the DLQ entry after
   confirming no balance impact.
