const http = require('http');
const createApp = require('./app');
const env = require('./config/env');
const { rootLogger } = require('./config/logger');
const { connectDB } = require('./config/supabase');
const initSocketIO = require('./sockets/io');
const sessionRepo = require('./repositories/session.repo');
const sessionManager = require('./baileys/sessionManager');

async function resumeExistingSessions(io) {
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

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    rootLogger.info({ signal }, 'Shutting down gracefully');

    // Stop Baileys sockets first. This is critical during nodemon/systemd/
    // container restarts: the old process must release its WhatsApp Web socket
    // before the new process starts using the same persisted Signal state.
    await sessionManager.shutdownAllSessions();

    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
    rootLogger.info('HTTP and WhatsApp connections closed');
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('unhandledRejection', (err) => rootLogger.error({ err }, 'Unhandled promise rejection'));
  process.on('uncaughtException', (err) => rootLogger.error({ err }, 'Uncaught exception'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
