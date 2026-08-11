import { register, Counter, Histogram, Gauge } from 'prom-client';
import { env } from '../../config/env.js';
import { getDatabaseConnectionMetrics } from '../persistence/prisma/client.js';

register.setDefaultLabels({ service: 'aistickers-backend', env: env.NODE_ENV });

function getOrCreateMetric(MetricClass, options) {
  const existing = register.getSingleMetric(options.name);
  if (existing) return existing;
  return new MetricClass(options);
}

const httpRequestsTotal = getOrCreateMetric(Counter, {
  name: 'http_requests_total',
  help: 'Total HTTP requests by method, normalized route and status code',
  labelNames: ['method', 'route', 'status']
});

const httpRequestDurationMs = getOrCreateMetric(Histogram, {
  name: 'http_request_duration_ms',
  help: 'HTTP request latency in milliseconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
});

const authFailuresTotal = getOrCreateMetric(Counter, {
  name: 'auth_failures_total',
  help: 'Authentication and HMAC failures by type',
  labelNames: ['type']
});

const rateLimitHitsTotal = getOrCreateMetric(Counter, {
  name: 'rate_limit_hits_total',
  help: 'Rate limit rejections by scope',
  labelNames: ['scope']
});

const dependencyUp = getOrCreateMetric(Gauge, {
  name: 'dependency_up',
  help: 'Readiness state of critical dependencies (1 = ready, 0 = not ready)',
  labelNames: ['name']
});

const queueJobsGauge = getOrCreateMetric(Gauge, {
  name: 'queue_jobs',
  help: 'Number of jobs in a queue by state',
  labelNames: ['queue', 'state']
});

const jobOutcomesTotal = getOrCreateMetric(Counter, {
  name: 'job_outcomes_total',
  help: 'Queue job outcomes by queue, status, provider and job type',
  labelNames: ['queue', 'status', 'provider', 'type']
});

const aiCallsTotal = getOrCreateMetric(Counter, {
  name: 'ai_calls_total',
  help: 'Calls to AI providers by provider and generation type',
  labelNames: ['provider', 'type']
});

const aiErrorsTotal = getOrCreateMetric(Counter, {
  name: 'ai_errors_total',
  help: 'AI call failures by provider, type and error category',
  labelNames: ['provider', 'type', 'category']
});

const aiCostUsdTotal = getOrCreateMetric(Counter, {
  name: 'ai_cost_usd_total',
  help: 'Estimated AI spend in USD by provider and generation type',
  labelNames: ['provider', 'type']
});

const purchasesTotal = getOrCreateMetric(Counter, {
  name: 'purchases_total',
  help: 'Purchase state transitions',
  labelNames: ['state']
});

const purchaseRefundsTotal = getOrCreateMetric(Counter, {
  name: 'purchase_refunds_total',
  help: 'Total purchase refunds issued'
});

const paymentReconcileDiscrepanciesTotal = getOrCreateMetric(Counter, {
  name: 'payment_reconcile_discrepancies_total',
  help: 'Discrepancies detected during payment reconciliation'
});

const queueDlqEntriesTotal = getOrCreateMetric(Counter, {
  name: 'queue_dlq_entries_total',
  help: 'Jobs moved to a dead-letter queue by queue name',
  labelNames: ['queue']
});

const pendingPurchaseAgeSeconds = getOrCreateMetric(Gauge, {
  name: 'payment_pending_age_seconds',
  help: 'Age in seconds of the oldest pending purchase'
});

let dbConnectionsInUseGauge = null;
let dbConnectionsIdleGauge = null;
if (env.DATABASE_URL) {
  dbConnectionsInUseGauge = getOrCreateMetric(Gauge, {
    name: 'db_connections_in_use',
    help: 'Database connections currently in use'
  });
  dbConnectionsIdleGauge = getOrCreateMetric(Gauge, {
    name: 'db_connections_idle',
    help: 'Database connections currently idle'
  });
}

function sanitizeLabel(value) {
  if (!value || typeof value !== 'string') return 'unknown';
  // Prom metric names/values can contain spaces; replace common separators but keep safe chars.
  const sanitized = value.replace(/[\n\r]/g, '').slice(0, 128);
  return sanitized || 'unknown';
}

function normalizeRoute(route) {
  if (!route) return 'unmatched';
  // Keep route parameters as Express patterns, drop query strings.
  return String(route).split('?')[0] || 'unmatched';
}

export const metrics = {
  register,

  httpRequest(method, route, status, durationMs) {
    const methodLabel = sanitizeLabel(method).toUpperCase();
    const routeLabel = normalizeRoute(route);
    const statusLabel = sanitizeLabel(status);
    httpRequestsTotal.inc({ method: methodLabel, route: routeLabel, status: statusLabel });
    httpRequestDurationMs.observe(
      { method: methodLabel, route: routeLabel, status: statusLabel },
      Number(durationMs) || 0
    );
  },

  authFailure(type) {
    authFailuresTotal.inc({ type: sanitizeLabel(type) });
  },

  rateLimitHit(scope) {
    rateLimitHitsTotal.inc({ scope: sanitizeLabel(scope) });
  },

  dependencyReady(name, isReady) {
    dependencyUp.set({ name: sanitizeLabel(name) }, isReady ? 1 : 0);
  },

  setQueueCounts(queueName, counts) {
    const name = sanitizeLabel(queueName);
    for (const state of ['queued', 'active', 'failed', 'stalled', 'delayed']) {
      queueJobsGauge.set({ queue: name, state }, Number(counts[state]) || 0);
    }
  },

  jobOutcome(queue, status, provider = 'unknown', type = 'unknown') {
    jobOutcomesTotal.inc({
      queue: sanitizeLabel(queue),
      status: sanitizeLabel(status),
      provider: sanitizeLabel(provider),
      type: sanitizeLabel(type)
    });
  },

  aiCall(provider, type) {
    aiCallsTotal.inc({ provider: sanitizeLabel(provider), type: sanitizeLabel(type) });
  },

  aiError(provider, type, category) {
    aiErrorsTotal.inc({
      provider: sanitizeLabel(provider),
      type: sanitizeLabel(type),
      category: sanitizeLabel(category)
    });
  },

  aiCost(provider, type, usd) {
    const value = Number(usd);
    if (!Number.isFinite(value) || value <= 0) return;
    aiCostUsdTotal.inc({ provider: sanitizeLabel(provider), type: sanitizeLabel(type) }, value);
  },

  purchaseState(state) {
    purchasesTotal.inc({ state: sanitizeLabel(state) });
  },

  purchaseRefund() {
    purchaseRefundsTotal.inc();
  },

  reconcileDiscrepancy() {
    paymentReconcileDiscrepanciesTotal.inc();
  },

  dlqEntry(queue) {
    queueDlqEntriesTotal.inc({ queue: sanitizeLabel(queue) });
  },

  setPendingPurchaseAge(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return;
    pendingPurchaseAgeSeconds.set(value);
  },

  dbConnectionsInUse(count) {
    const value = Number(count);
    if (!Number.isFinite(value) || value < 0 || !dbConnectionsInUseGauge) return;
    dbConnectionsInUseGauge.set(value);
  },

  dbConnectionsIdle(count) {
    const value = Number(count);
    if (!Number.isFinite(value) || value < 0 || !dbConnectionsIdleGauge) return;
    dbConnectionsIdleGauge.set(value);
  },

  async collectDatabaseConnections() {
    if (!dbConnectionsInUseGauge || !dbConnectionsIdleGauge) return;
    const counts = await getDatabaseConnectionMetrics();
    this.dbConnectionsInUse(counts.inUse);
    this.dbConnectionsIdle(counts.idle);
  },

  reset() {
    // Primarily useful in tests.
    register.resetMetrics();
  }
};
