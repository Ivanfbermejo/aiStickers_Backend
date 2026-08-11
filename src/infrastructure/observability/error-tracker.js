import { env } from '../../config/env.js';
import { getLogger } from './logger.js';
import { scrub, scrubString } from './scrub.js';

let sentry;
let initialized = false;

function scrubSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;
  return scrub(event);
}

function validateSentryDsn(dsn) {
  return /^https?:\/\/[^/\s]+@[^/\s]+\/\d+\/?$/.test(dsn);
}

export async function initErrorTracker() {
  if (!env.ERROR_TRACKING_ENABLED) {
    return;
  }
  if (!env.SENTRY_DSN) {
    throw new Error('Error tracking is enabled but SENTRY_DSN is not configured');
  }
  if (!validateSentryDsn(env.SENTRY_DSN)) {
    throw new Error('SENTRY_DSN appears to be invalid');
  }
  try {
    const mod = await import('@sentry/node');
    sentry = mod.default || mod;
    sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      beforeSend(event) {
        return scrubSentryEvent(event);
      },
      beforeSendTransaction(transaction) {
        return scrubSentryEvent(transaction);
      }
    });
    initialized = true;
    getLogger().info('Error tracking initialized');
  } catch (error) {
    getLogger().error({ err: error }, 'Error tracker initialization failed');
    throw new Error(`Failed to initialize error tracker: ${error.message}`);
  }
}

export function captureException(error, context = {}) {
  if (!initialized || !sentry) return;
  try {
    const safeError = error instanceof Error
      ? Object.assign(new Error(scrubString(error.message)), { name: error.name, code: error.code })
      : new Error(scrubString(String(error)));
    sentry.captureException(safeError, { contexts: { app: scrub(context) } });
  } catch (sendError) {
    getLogger().warn({ err: sendError }, 'Failed to send error event to tracker');
  }
}

export function captureMessage(message, level = 'info', context = {}) {
  if (!initialized || !sentry) return;
  try {
    sentry.captureMessage(scrubString(message), {
      level,
      contexts: { app: scrub(context) }
    });
  } catch (sendError) {
    getLogger().warn({ err: sendError }, 'Failed to send message event to tracker');
  }
}
