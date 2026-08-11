import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';
import { env } from '../../config/env.js';
import { scrub, scrubString } from './scrub.js';

const asyncLocalStorage = new AsyncLocalStorage();

function sanitizeError(error) {
  if (!(error instanceof Error)) return error;
  const redacted = scrub(error);
  const sanitized = new Error(redacted.message);
  sanitized.name = error.name || redacted.type || 'Error';
  sanitized.code = redacted.code;
  if (redacted.stack) {
    sanitized.stack = redacted.stack;
  }
  return sanitized;
}

function sanitizeArg(arg) {
  if (arg === undefined || arg === null) return arg;
  if (typeof arg === 'string') return scrubString(arg);
  if (typeof arg === 'number' || typeof arg === 'boolean') return arg;
  if (arg instanceof Error) return sanitizeError(arg);
  if (typeof arg === 'object') {
    if (arg.err instanceof Error) {
      return { ...scrub(arg), err: sanitizeError(arg.err) };
    }
    return scrub(arg);
  }
  return String(arg);
}

function wrapPino(logger) {
  return new Proxy(logger, {
    get(target, property) {
      const value = target[property];
      if (property === 'child') {
        return (bindings, ...childArgs) => {
          const child = value.call(target, sanitizeArg(bindings), ...childArgs.map(sanitizeArg));
          return wrapPino(child);
        };
      }
      if (typeof value === 'function') {
        return (...args) => value.apply(target, args.map(sanitizeArg));
      }
      return value;
    }
  });
}

function buildLogger() {
  const level = env.LOG_LEVEL || (env.NODE_ENV === 'test' ? 'silent' : 'info');
  return wrapPino(
    pino({
      level,
      base: { pid: process.pid, env: env.NODE_ENV }
    })
  );
}

let rootLogger = buildLogger();

export { rootLogger, asyncLocalStorage };

export function getLogger() {
  const store = asyncLocalStorage.getStore();
  if (!store || !store.correlationId) {
    return rootLogger;
  }
  return rootLogger.child({ correlationId: store.correlationId });
}

export function getCorrelationId() {
  return asyncLocalStorage.getStore()?.correlationId;
}

export function withCorrelationId(correlationId, fn) {
  return asyncLocalStorage.run({ correlationId }, fn);
}

export function bindCorrelationId(correlationId, callback) {
  return (...args) => asyncLocalStorage.run({ correlationId }, () => callback(...args));
}
