# AI provider down runbook

## Symptoms

- `ai_errors_total` rising with category `provider`, `timeout`, or `transient`.
- `queue_jobs{queue="generation",state="active"}` grows but completions are low.
- Replicate status endpoint returns errors or high latency.

## Investigation

1. Check `http_request_duration_ms` for `/api/v1/ai/*` and generation job
   latency.
2. Look for `PROVIDER_TIMEOUT` errors in worker logs by `correlationId`.
3. Verify whether the outage is global or regional from the provider status page.

## Remediation

1. If the provider supports fallback regions/models, update `REPLICATE_MODEL`
   through env and redeploy.
2. If no fallback is configured, the queue will back off exponentially. Do not
   restart workers repeatedly; this resets the backoff and wastes resources.
3. If the outage is prolonged, consider pausing generation by setting
   `GENERATION_QUEUE_ENABLED=false` on producers (workers still drain existing
   jobs) and notify users.
4. After recovery, monitor DLQ replay and confirm stuck jobs resume.
