const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const { rootLogger } = require('./config/logger');
const routes = require('./routes');
const { apiLimiter } = require('./middleware/rateLimiters');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const REQUEST_TIMEOUT_MS = 60 * 1000;

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN }));

  // Request-size protection. JSON was already capped at 5 MB; keep the
  // URL-encoded parser bounded too so one parser cannot bypass the policy.
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Every request gets a traceable ID which is also returned to the client.
  // This is useful when correlating client errors with Pino logs.
  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    req.requestId = String(requestId);
    res.setHeader('X-Request-ID', req.requestId);
    next();
  });

  app.use(pinoHttp({
    logger: rootLogger,
    autoLogging: { ignore: (req) => req.url === '/health' },
    customProps: (req) => ({ requestId: req.requestId }),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.headers["x-realtime-token"]',
        'req.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
  }));

  // General API protection: 100 requests/minute per IP. More specific
  // limiter profiles are exported for future non-WhatsApp CRM/admin routes.
  app.use('/api', apiLimiter);

  // Prevent requests from hanging indefinitely at the HTTP layer.
  app.use((req, res, next) => {
    req.setTimeout(REQUEST_TIMEOUT_MS);
    res.setTimeout(REQUEST_TIMEOUT_MS);
    next();
  });

  app.get('/health', (req, res) => res.json({ success: true, status: 'ok', uptime: process.uptime() }));

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
