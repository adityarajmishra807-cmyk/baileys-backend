const { Server } = require('socket.io');
const env = require('../config/env');
const { rootLogger } = require('../config/logger');
const { verifyToken } = require('./token');

function initSocketIO(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.CORS_ORIGIN },
  });

  if (env.REDIS_ENABLED) {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
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
    if (!env.API_KEY) return next();

    const apiToken = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (apiToken === env.API_KEY) {
      socket.data.allowedSessions = null; // trusted server-side API client
      return next();
    }

    const realtime = verifyToken(socket.handshake.auth?.realtimeToken);
    if (!realtime) return next(new Error('Unauthorized'));
    socket.data.allowedSessions = realtime.sessionIds;
    socket.data.realtimeTokenExpiresAt = realtime.exp;
    return next();
  });

  io.on('connection', (socket) => {
    rootLogger.info({ socketId: socket.id }, 'Socket.IO client connected');

    socket.on('join', (sessionId) => {
      if (typeof sessionId !== 'string' || !sessionId) return;
      if (socket.data.allowedSessions && !socket.data.allowedSessions.has(sessionId)) {
        socket.emit('socket.error', { error: 'Session is not authorized for this realtime connection.' });
        return;
      }
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
