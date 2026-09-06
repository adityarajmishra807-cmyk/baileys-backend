const http = require('http');
const createApp = require('./app');
const env = require('./config/env');
const { rootLogger } = require('./config/logger');
const { connectDB } = require('./config/supabase');
const initSocketIO = require('./sockets/io');
const sessionRepo = require('./repositories/session.repo');
const sessionManager = require('./baileys/sessionManager');

async function resumeExistingSessions(io) {
  // Reconnect every session that wasn't explicitly logged out, so a server
  // restart/redeploy never forces the user to re-scan the QR code.
  const sessionIds = await sessionRepo.findActiveSessionIds();
  rootLogger.info({ count: sessionIds.length }, 'Resuming existing WhatsApp sessions');
  for (const sessionId of sessionIds) {
    sessionManager.startSession(sessionId, io).catch((err) => {
      rootLogger.error({ err, sessionId }, 'Failed to resume session on boot');
    });
  }
}

async function main() {
  await connectDB();

  const app = createApp();
  const httpServer = http.createServer(app);
  const io = initSocketIO(httpServer);
  app.set('io', io);

  httpServer.listen(env.PORT, () => {
    rootLogger.info(`Server listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  await resumeExistingSessions(io);

  const shutdown = async (signal) => {
    rootLogger.info({ signal }, 'Shutting down gracefully');
    httpServer.close(() => rootLogger.info('HTTP server closed'));
    io.close();
    // Supabase's client is a stateless REST wrapper — no connection/pool to
    // explicitly close before exiting.
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => rootLogger.error({ err }, 'Unhandled promise rejection'));
  process.on('uncaughtException', (err) => rootLogger.error({ err }, 'Uncaught exception'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
