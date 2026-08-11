# Alerts and responsibles

All thresholds are **provisional** and configurable. The service owner must
approve them before production.

| Alert | Threshold | Severity | Owner | Runbook |
|-------|-----------|----------|-------|---------|
| `readiness_failed` | `/health/ready` != 200 for 2 consecutive probes | P1 (page) | SRE on-call | [Dependencies down](./dependencies-down.md) |
| `http_5xx_rate` | 5xx rate > 1% over 5 min | P1 | SRE on-call | Deploy/rollback |
| `http_latency_p95` | P95 latency > 2000 ms for 5 min | P2 | Backend team | [AI provider down](./ai-provider-down.md) |
| `auth_failures_rate` | auth/hmac failures > 10% of requests over 5 min | P2 | Security / Backend | Investigate client/version mismatch or abuse |
| `rate_limit_hits` | > 1000 hits/min on any scope | P2 | Backend | Investigate abuse or misconfigured limits |
| `dependency_down` | `dependency_up` == 0 for DB/Redis/storage > 1 min | P1 | SRE on-call | [Dependencies down](./dependencies-down.md) |
| `queue_dlq_growth` | `queue_jobs{state="failed"}` rising over 10 min | P2 | Backend | [Queue and DLQ](./queue-and-dlq.md) |
| `payment_pending_age` | oldest pending purchase > 30 min | P2 | Backend / Billing | [Payment stuck](./payment-stuck.md) |
| `reconcile_discrepancy` | `payment_reconcile_discrepancies_total` increases | P2 | Backend / Billing | [Payment stuck](./payment-stuck.md) |
| `ai_cost_spike` | `ai_cost_usd_total` / hour > budget | P3 | Backend / Finance | [AI provider down](./ai-provider-down.md) |

## Routing

- P1 alerts page the SRE on-call.
- P2 alerts open a ticket in the backend team queue.
- Billing-related P2 alerts also notify the billing contact configured in the
  incident channel.

## Dashboard

Prometheus metrics are exposed at `/metrics` (disabled by default; requires
`METRICS_ENABLED=true` and a bearer token from `METRICS_BEARER_TOKEN`). Use this
endpoint to build dashboards; never expose it publicly.
