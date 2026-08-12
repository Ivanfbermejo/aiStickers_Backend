# Operations runbooks

This folder contains concise runbooks for operating the aiStickers backend in
staging and production. All objectives and thresholds are **configurable via
environment variables**; any numbers shown are provisional defaults. They
require explicit approval from the service owner before being adopted in
production.

- [Deploy and rollback](./deploy-and-rollback.md)
- [Payment stuck](./payment-stuck.md)
- [Queue and DLQ](./queue-and-dlq.md)
- [AI provider down](./ai-provider-down.md)
- [PostgreSQL / Redis / storage down](./dependencies-down.md)
- [Log rotation and retention](./logging-and-retention.md)
- [Alerts and responsibles](./alerts-and-responsibles.md)
- [Backup and restore](./backup-restore.md)

## Provisional recovery objectives

| Objective | Default | Owner approval required |
|-----------|---------|-------------------------|
| RPO (Recovery Point Objective) | 24 hours | Yes for production |
| RTO (Recovery Time Objective) | 4 hours | Yes for production |

Change these via the backup schedule and restore playbook. A backup is not
considered valid until a restore drill has completed successfully.
