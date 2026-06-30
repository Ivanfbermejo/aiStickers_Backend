# CI and automated checks

This repository uses GitHub Actions to protect the existing API contract, avoid
insecure code patterns, and verify that the backend can start with safe dummy
credentials in CI.

## Workflows

### `ci.yml`

Runs on every PR and push to `main`:

- Installs dependencies with `npm ci`.
- Runs `node --check index.js` to catch syntax errors.
- Runs tests if a `test` script is present.
- Starts the server with dummy environment variables and checks the
  `/health` endpoint.

If the smoke start fails, review the server output in the workflow logs. The
most common cause is a missing `import` or an unhandled exception during
`container.initialize()`.

### `security.yml`

Runs on every PR and push to `main`:

- Runs `npm audit --audit-level=high` (reported but not blocking by default).
- Scans source files for:
  - Insecure fallbacks such as `JWT_SECRET || 'some-string'`.
  - Hardcoded secrets for sensitive variables (JWT, client secrets, API tokens,
    Telegram token, etc.).
  - Private keys committed to source.

The scan intentionally skips `node_modules`, `.git`, `.github` and `tmp-data`.

### `api-contract.yml`

Runs on every PR and push to `main`:

- Checks that the Android-facing endpoints defined in `index.js` still exist.
- Verifies that existing endpoints keep their required middleware (`requireHmac`,
  `requireAuth`/`requireUser`).
- Enforces that any new private endpoint matching `/api/v1/generation/*` or any
  WhatsApp export route (`/api/v1/stickers/:id/export/whatsapp`,
  `/api/v1/packages/:id/export/whatsapp`) uses both `requireHmac` and
  `requireUser`.

### `deploy-sanity.yml`

Runs on every PR and push to `main`:

- Verifies that `package.json` has a `start` script.
- Starts the server with a non-default port and dummy environment variables.
- Confirms that the process only writes inside the configured `DATA_DIR`.

## Dummy CI values

All workflows use safe dummy values. No real tokens are stored in the YAML
files:

```yaml
NODE_ENV: test
PORT: 22024
JWT_SECRET: test_jwt_secret_minimum_32_chars_long
CLIENT_SECRET: test_client_secret_minimum_32_chars
CLIENT_ID: ai-stickers-test
TELEGRAM_BOT_TOKEN: test-token
DATA_DIR: ./tmp-data
```

## How to run the checks locally

```bash
npm ci
node --check index.js
node scripts/security-scan.js
node scripts/api-contract-check.js
node scripts/smoke-start.js
node scripts/deploy-sanity-check.js
```

The smoke and deploy-sanity scripts use `DATA_DIR=./tmp-data` by default. They
clean that directory before each run, so do not point `DATA_DIR` at a folder
containing real data.

## Interpreting failures

- **CI / Syntax check**: a JavaScript syntax or import error in `index.js`.
- **Security / insecure fallback**: a secret variable has a fallback value
  instead of reading from `process.env`.
- **API contract / missing route**: an endpoint required by the Android app was
  removed or renamed.
- **API contract / missing middleware**: an endpoint lost its `requireHmac` or
  `requireUser` guard.
- **Deploy sanity**: the server cannot start with dummy envs, or it writes
  outside `DATA_DIR`.

## Out of scope

These workflows do **not** deploy to Railway or replace a full test suite. They
are the minimum safety net for backend evolution while Android clients depend on
the endpoints above.
