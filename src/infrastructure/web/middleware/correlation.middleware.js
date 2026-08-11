import { validate as uuidValidate, version as uuidVersion } from 'uuid';
import { v4 as uuidv4 } from 'uuid';
import {
  asyncLocalStorage,
  bindCorrelationId,
  getLogger
} from '../../observability/logger.js';

const REQUEST_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function isSafeRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_RE.test(value);
}

export function correlationMiddleware(req, res, next) {
  const headerValue = req.headers['x-request-id'];
  let correlationId = isSafeRequestId(headerValue) ? headerValue : uuidv4();

  // If the caller provided a syntactically-valid UUID but not v4, still accept it.
  if (typeof headerValue === 'string' && uuidValidate(headerValue) && uuidVersion(headerValue) === 4) {
    correlationId = headerValue;
  } else if (typeof headerValue === 'string' && isSafeRequestId(headerValue)) {
    correlationId = headerValue;
  } else {
    correlationId = uuidv4();
  }

  res.setHeader('x-request-id', correlationId);
  req.correlationId = correlationId;

  const log = getLogger();
  log.debug({ req: { method: req.method, path: req.path, correlationId } }, 'request started');

  asyncLocalStorage.run({ correlationId }, () => {
    res.on(
      'finish',
      bindCorrelationId(correlationId, () => {
        const route = req.route?.path;
        log.debug(
          {
            req: {
              method: req.method,
              path: req.path,
              route,
              statusCode: res.statusCode,
              correlationId
            }
          },
          'request finished'
        );
      })
    );
    next();
  });
}
