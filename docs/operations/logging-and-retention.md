# Log rotation and retention

## Output

The application writes structured JSON logs to **stdout/stderr only**. No log
files are created inside the container. The runtime (Docker, Kubernetes, etc.)
is responsible for collection and rotation.

## Recommended configuration

### Docker / Compose

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

### Kubernetes

```yaml
resources:
  limits:
    ephemeral-storage: "1Gi"
```

Use a cluster-level log collector with retention:
- Hot: 7 days
- Warm: 30 days
- Cold/archive: 90 days (or per compliance requirement)

## Sensitive data

Logs are scrubbed by the logger for authorization, tokens, receipts, emails,
prompts, base64 payloads, and signed URL query strings. Do not configure the log
shipper to capture raw request/response bodies.

## Audit

- Review log redaction samples after each deploy.
- Keep `npm audit --omit=dev` at zero.
