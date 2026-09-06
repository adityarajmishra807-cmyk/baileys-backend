const pino = require('pino');
const env = require('./env');

const transport = env.NODE_ENV !== 'production'
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
  : undefined;

const rootLogger = pino({
  level: env.LOG_LEVEL,
  transport,
  base: { service: 'baileys-backend' },
});

/**
 * Returns a child logger scoped to a WhatsApp session — every log line
 * carries the sessionId so multi-account logs can be filtered/aggregated.
 */
function getSessionLogger(sessionId) {
  return rootLogger.child({ sessionId });
}

module.exports = { rootLogger, getSessionLogger };
