import { metrics } from '../../observability/metrics.js';
import { bindCorrelationId, getCorrelationId } from '../../observability/logger.js';

export function requestMetricsMiddleware(req, res, next) {
  const app = req.app;
  app.locals.activeRequests += 1;
  const start = process.hrtime.bigint();
  const correlationId = getCorrelationId();
  let tracked = false;

  const decrementActiveRequests = () => {
    if (tracked) return;
    tracked = true;
    app.locals.activeRequests -= 1;

  };

  res.on(
    'finish',
    bindCorrelationId(correlationId || 'unknown', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const route = req.route?.path;
      const statusCode = String(res.statusCode);
      metrics.httpRequest(req.method, route, statusCode, durationMs);
      decrementActiveRequests();
    })
  );

  res.on('close', decrementActiveRequests);

  next();
}
