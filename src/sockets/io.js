const { Server } = require('socket.io');
const env = require('../config/env');
const { rootLogger } = require('../config/logger');

/**
 * Frontend clients connect, authenticate (same API key as the REST API),
 * then `join` the room for whichever session(s) they want realtime updates
 * for. sessionManager emits events into `session:<id>` rooms — see
 * src/baileys/sessionManager.js.
 */
function initSocketIO(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN },
  });

  if (env.REDIS_ENABLED) {
    // Lets Socket.IO broadcast `session:<id>` room events across multiple
    // Node processes/pods — needed once you run more than one instance.
    // Note: WhatsApp sockets themselves still live in-process (see
    // sessionManager's in-memory `sessions` map), so pin each sessionId to a
    // single instance (e.g. consistent hashing at your load balancer) even
    // with this adapter in place.
    try {
      // eslint-disable-next-line global-require
      const { createAdapter } = require('@socket.io/redis-adapter');
      // eslint-disable-next-line global-require
      const IORedis = require('ioredis');
      const pubClient = new IORedis(env.REDIS_URL);
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      rootLogger.info('Socket.IO Redis adapter enabled');
    } catch (err) {
      rootLogger.error({ err }, 'Failed to enable Redis adapter — falling back to in-memory (single instance only)');
    }
  }

  io.use((socket, next) => {
    if (!env.API_KEY) return next(); // dev convenience
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token !== env.API_KEY) return next(new Error('Unauthorized'));
    return next();
  });

  io.on('connection', (socket) => {
    rootLogger.info({ socketId: socket.id }, 'Socket.IO client connected');

    socket.on('join', (sessionId) => {
      if (typeof sessionId !== 'string') return;
      socket.join(`session:${sessionId}`);
      socket.emit('joined', { sessionId });
    });

    socket.on('leave', (sessionId) => {
      if (typeof sessionId !== 'string') return;
      socket.leave(`session:${sessionId}`);
    });

    socket.on('disconnect', (reason) => {
      rootLogger.info({ socketId: socket.id, reason }, 'Socket.IO client disconnected');
    });
  });

  return io;
}

module.exports = initSocketIO;
