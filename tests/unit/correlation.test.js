import { describe, it, expect, beforeEach } from 'vitest';
import { correlationMiddleware } from '../../src/infrastructure/web/middleware/correlation.middleware.js';
import { getCorrelationId, withCorrelationId, getLogger, rootLogger } from '../../src/infrastructure/observability/logger.js';

describe('correlation middleware', () => {
  it('generates a UUID when x-request-id is missing', () => {
    let storedId = null;
    const req = { headers: {}, path: '/test', method: 'GET' };
    const res = {
      setHeader: (name, value) => { storedId = value; },
      on: () => {}
    };
    correlationMiddleware(req, res, () => {});
    expect(typeof storedId).toBe('string');
    expect(storedId.length).toBe(36);
    expect(req.correlationId).toBe(storedId);
  });

  it('accepts a safe existing x-request-id', () => {
    const req = { headers: { 'x-request-id': 'safe-request-id-123' }, path: '/test', method: 'GET' };
    const res = { setHeader: () => {}, on: () => {} };
    correlationMiddleware(req, res, () => {});
    expect(req.correlationId).toBe('safe-request-id-123');
  });

  it('rejects a too-long or unsafe x-request-id', () => {
    const bad = 'unsafe<script>';
    const req = { headers: { 'x-request-id': bad }, path: '/test', method: 'GET' };
    let set = null;
    const res = { setHeader: (n, v) => { set = v; }, on: () => {} };
    correlationMiddleware(req, res, () => {});
    expect(req.correlationId).not.toBe(bad);
    expect(set.length).toBe(36);
  });
});

describe('async local storage propagation', () => {
  it('propagates correlationId through async boundaries', async () => {
    const id = 'corr-123';
    const result = await withCorrelationId(id, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getCorrelationId();
    });
    expect(result).toBe(id);
  });

  it('binds logger with correlationId', () => {
    const logger = getLogger();
    // Outside an async context the logger should be the root logger (no correlationId).
    expect(logger).toBe(rootLogger);
  });
});
