# Payment stuck runbook

## Symptoms

- Users report credits not appearing after purchase.
- `purchases_total{state="pending"}` or reconcile discrepancy counter is rising.
- Alert `payment_pending_age_minutes` exceeds threshold (default 30 min).

## Investigation

1. Find the affected `purchaseId` via the database or logs; never use user email
   as a label in metrics.
2. Check `payment_reconcile_discrepancies_total` and `job_outcomes_total` for
   DLQ entries.
3. Run the reconciler in dry-run mode:
   ```bash
   node scripts/reconcile-payments.js --dry-run --batch-size 100
   ```
4. Review provider response status in logs (look for `GooglePlay` error codes).

## Remediation

1. If the provider is reachable and validation succeeds, run the reconciler
   without `--dry-run` to credit the purchase.
2. If the provider confirms the purchase as rejected, the reconciler will mark
   it `REJECTED` automatically.
3. If the provider is down, stop the reconciler and retry after the dependency
   recovers.
4. For repeated DLQ entries, inspect the dead-letter queue following
   [Queue and DLQ](./queue-and-dlq.md).
