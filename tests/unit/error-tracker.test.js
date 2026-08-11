import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/node', () => {
  const init = vi.fn();
  const captureException = vi.fn();
  const captureMessage = vi.fn();
  const sentry = { init, captureException, captureMessage };
  return { default: sentry, ...sentry };
});

async function importErrorTracker() {
  vi.resetModules();
  const { initErrorTracker, captureException, captureMessage } = await import(
    '../../src/infrastructure/observability/error-tracker.js'
  );
  return { initErrorTracker, captureException, captureMessage };
}

async function importSentryMock() {
  return import('@sentry/node');
}

describe('error-tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ERROR_TRACKING_ENABLED;
    delete process.env.SENTRY_DSN;
  });

  it('does nothing when error tracking is disabled', async () => {
    process.env.ERROR_TRACKING_ENABLED = 'false';
    const { initErrorTracker } = await importErrorTracker();
    await expect(initErrorTracker()).resolves.toBeUndefined();
    const sentry = await importSentryMock();
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('throws when enabled without a SENTRY_DSN', async () => {
    process.env.ERROR_TRACKING_ENABLED = 'true';
    const { initErrorTracker } = await importErrorTracker();
    await expect(initErrorTracker()).rejects.toThrow('SENTRY_DSN');
  });

  it('throws when SENTRY_DSN is invalid', async () => {
    process.env.ERROR_TRACKING_ENABLED = 'true';
    process.env.SENTRY_DSN = 'not-a-valid-dsn';
    const { initErrorTracker } = await importErrorTracker();
    await expect(initErrorTracker()).rejects.toThrow(/invalid/i);
  });

  it('initializes Sentry and scrubs sensitive context before captureException', async () => {
    process.env.ERROR_TRACKING_ENABLED = 'true';
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/1';

    const { initErrorTracker, captureException } = await importErrorTracker();
    await initErrorTracker();

    const error = new Error('boom');
    const context = {
      user: { email: 'leak@example.com', id: 123 },
      payload: { token: 'secret-token', receipt: 'receipt-data' }
    };
    captureException(error, context);

    const sentry = await importSentryMock();
    expect(sentry.init).toHaveBeenCalledOnce();
    expect(sentry.captureException).toHaveBeenCalledOnce();

    const [, options] = sentry.captureException.mock.calls[0];
    const app = options.contexts.app;
    const stringified = JSON.stringify(app);

    expect(stringified).not.toContain('leak@example.com');
    expect(stringified).not.toContain('secret-token');
    expect(stringified).not.toContain('receipt-data');
    expect(app.user.email).toBe('[REDACTED]');
    expect(app.payload.token).toBe('[REDACTED]');
    expect(app.payload.receipt).toBe('[REDACTED]');
    expect(app.user.id).toBe(123);
  });

  it('scrubs sensitive context before captureMessage', async () => {
    process.env.ERROR_TRACKING_ENABLED = 'true';
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/1';

    const { initErrorTracker, captureMessage } = await importErrorTracker();
    await initErrorTracker();

    const context = { jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature' };
    captureMessage('hello', 'info', context);

    const sentry = await importSentryMock();
    expect(sentry.captureMessage).toHaveBeenCalledOnce();
    const [, options] = sentry.captureMessage.mock.calls[0];
    const stringified = JSON.stringify(options.contexts.app);
    expect(stringified).not.toMatch(/eyJ/);
    expect(options.contexts.app.jwt).toBe('[REDACTED]');
    expect(options.level).toBe('info');
  });

  it('never forwards a complete DSN in an error message', async () => {
    process.env.ERROR_TRACKING_ENABLED = 'true';
    process.env.SENTRY_DSN = 'https://public@sentry.example.com/1';

    const { initErrorTracker, captureException } = await importErrorTracker();
    await initErrorTracker();
    captureException(new Error('failed for https://public@sentry.example.com/1'));

    const sentry = await importSentryMock();
    const [error] = sentry.captureException.mock.calls.at(-1);
    expect(error.message).not.toContain('https://public@sentry.example.com/1');
  });
});
