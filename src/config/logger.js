const path = require('path');
const pino = require('pino');
const env = require('./env');

// Write every log entry to a durable JSON file as well as the console.
// pino creates the logs directory automatically when needed.
const fileStream = pino.destination({
  dest: path.join(process.cwd(), 'logs', 'app.log'),
  mkdir: true,
  sync: false,
});

const consoleStream = env.NODE_ENV !== 'production'
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    })
  : process.stdout;

const rootLogger = pino(
  {
    level: env.LOG_LEVEL,
    base: { service: 'baileys-backend' },
  },
  pino.multistream([
    { level: env.LOG_LEVEL, stream: consoleStream },
    { level: env.LOG_LEVEL, stream: fileStream },
  ]),
);

/**
 * Returns a child logger scoped to a WhatsApp session — every log line
 * carries the sessionId so multi-account logs can be filtered/aggregated.
 */
function getSessionLogger(sessionId) {
  return rootLogger.child({ sessionId });
}

module.exports = { rootLogger, getSessionLogger };
