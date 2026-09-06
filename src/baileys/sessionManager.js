const QRCode = require('qrcode');
const { Boom } = require('@hapi/boom');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const env = require('../config/env');
const { getSessionLogger } = require('../config/logger');
const { useSupabaseAuthState, clearAuthState } = require('./authState');
const { bindStore, getCachedGroupMetadataFactory } = require('./store');
const sessionRepo = require('../repositories/session.repo');
const messageRepo = require('../repositories/message.repo');
const chatRepo = require('../repositories/chat.repo');
const contactRepo = require('../repositories/contact.repo');
const groupRepo = require('../repositories/group.repo');

// In-memory registry of live sockets for this process.
// key: sessionId -> { sock, status, reconnectAttempts, reconnectTimer }
const sessions = new Map();

// Sessions explicitly stopped by the user must never be recreated by a late
// Baileys connection.update('close') event or by an already scheduled timer.
const disabledSessions = new Set();
const reconnectTimers = new Map();

const MAX_RECONNECT_DELAY_MS = 30_000;

function backoffDelay(attempt) {
  return Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
}

/** Rehydrates a stored, JSON-safe WebMessageInfo back into a message for getMessage/retries. */
async function loadStoredMessage(sessionId, jid, id) {
  const msg = await messageRepo.findOne(sessionId, jid, id);
  return msg?.content?.message || undefined;
}

/**
 * Starts (or restarts) a WhatsApp connection for `sessionId`.
 * `io` is the Socket.IO server used to push realtime events (qr, connection
 * status, incoming messages, presence, etc.) to subscribed frontend clients.
 */
async function startSession(sessionId, io) {
  // An explicit start is an intentional user action, so it re-enables a
  // previously deleted/stopped session ID. Auto-reconnects are guarded below.
  disabledSessions.delete(sessionId);

  const logger = getSessionLogger(sessionId);
  const existing = sessions.get(sessionId);
  if (existing?.sock && (existing.status === 'open' || existing.status === 'connecting')) {
    logger.info('Session already active, skipping duplicate start');
    return existing.sock;
  }

  const { state, saveCreds } = await useSupabaseAuthState(sessionId);
  const { version } = await fetchLatestBaileysVersion();

  // The session may have been deleted while the async auth/version work was
  // in progress. Do not recreate anything in that case.
  if (disabledSessions.has(sessionId)) {
    logger.info('Session start aborted because it was disabled during setup');
    return null;
  }

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    generateHighQualityLinkPreview: true,
    syncFullHistory: env.SYNC_FULL_HISTORY,
    markOnlineOnConnect: env.MARK_ONLINE_ON_CONNECT,
    cachedGroupMetadata: getCachedGroupMetadataFactory(sessionId),
    getMessage: (key) => loadStoredMessage(sessionId, key.remoteJid, key.id),
  });

  if (disabledSessions.has(sessionId)) {
    try { sock.end(undefined); } catch (err) { /* noop */ }
    logger.info('Session socket closed because it was disabled during startup');
    return null;
  }

  const entry = { sock, status: 'connecting', reconnectAttempts: 0, reconnectTimer: null };
  sessions.set(sessionId, entry);
  await sessionRepo.upsert(sessionId, { status: 'connecting' });

  bindStore(sock, sessionId, logger);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    const current = sessions.get(sessionId);
    if (disabledSessions.has(sessionId) || current?.sock !== sock) return;

    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr);
      if (disabledSessions.has(sessionId) || sessions.get(sessionId)?.sock !== sock) return;
      await sessionRepo.upsert(sessionId, { status: 'qr', qr: qrDataUrl });
      io?.to(`session:${sessionId}`).emit('qr', { sessionId, qr: qrDataUrl });
      logger.info('QR code generated, waiting for scan');
    }

    if (connection === 'open') {
      const latest = sessions.get(sessionId);
      if (disabledSessions.has(sessionId) || latest?.sock !== sock) return;
      latest.status = 'open';
      latest.reconnectAttempts = 0;
      await sessionRepo.upsert(sessionId, {
        status: 'open',
        qr: null,
        lastConnectedAt: new Date().toISOString(),
        me: { id: sock.user?.id, name: sock.user?.name },
      });
      io?.to(`session:${sessionId}`).emit('connection.update', { sessionId, status: 'open', me: sock.user });
      logger.info({ me: sock.user }, 'Connection opened');
    }

    if (connection === 'close') {
      const latest = sessions.get(sessionId);
      if (disabledSessions.has(sessionId) || latest?.sock !== sock) return;

      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      latest.status = 'close';
      await sessionRepo.upsert(sessionId, {
        status: loggedOut ? 'logged_out' : 'close',
        lastDisconnectReason: lastDisconnect?.error?.message || String(statusCode || 'unknown'),
      });
      io?.to(`session:${sessionId}`).emit('connection.update', {
        sessionId,
        status: loggedOut ? 'logged_out' : 'close',
        reason: lastDisconnect?.error?.message,
      });

      if (loggedOut) {
        logger.warn('Session logged out from phone — clearing auth, will not auto-reconnect');
        await clearAuthState(sessionId);
        if (sessions.get(sessionId)?.sock === sock) sessions.delete(sessionId);
        return;
      }

      if (disabledSessions.has(sessionId) || sessions.get(sessionId)?.sock !== sock) return;

      const attempt = (latest.reconnectAttempts || 0) + 1;
      latest.reconnectAttempts = attempt;
      const delay = backoffDelay(attempt);
      logger.warn({ attempt, delay, statusCode }, 'Connection closed, reconnecting');

      const timer = setTimeout(() => {
        reconnectTimers.delete(sessionId);
        const currentEntry = sessions.get(sessionId);
        if (disabledSessions.has(sessionId) || currentEntry?.sock !== sock) return;
        startSession(sessionId, io).catch((err) => logger.error({ err }, 'Reconnect failed'));
      }, delay);
      latest.reconnectTimer = timer;
      reconnectTimers.set(sessionId, timer);
    }
  });

  // Forward WhatsApp changes to subscribed frontend clients over Socket.IO.
  sock.ev.on('presence.update', (presence) => io?.to(`session:${sessionId}`).emit('presence.update', { sessionId, ...presence }));
  sock.ev.on('messages.upsert', (payload) => io?.to(`session:${sessionId}`).emit('messages.upsert', { sessionId, ...payload }));
  sock.ev.on('messages.update', (payload) => io?.to(`session:${sessionId}`).emit('messages.update', { sessionId, payload }));
  sock.ev.on('messages.delete', (payload) => io?.to(`session:${sessionId}`).emit('messages.delete', { sessionId, payload }));
  sock.ev.on('chats.upsert', (payload) => io?.to(`session:${sessionId}`).emit('chats.upsert', { sessionId, payload }));
  sock.ev.on('chats.update', (payload) => io?.to(`session:${sessionId}`).emit('chats.update', { sessionId, payload }));
  sock.ev.on('chats.delete', (payload) => io?.to(`session:${sessionId}`).emit('chats.delete', { sessionId, payload }));
  sock.ev.on('group-participants.update', (payload) => io?.to(`session:${sessionId}`).emit('group-participants.update', { sessionId, ...payload }));
  sock.ev.on('call', (payload) => {
    logger.info({ payload }, 'Incoming call event');
    io?.to(`session:${sessionId}`).emit('call', { sessionId, payload });
  });

  return sock;
}

function getSocket(sessionId) {
  const entry = sessions.get(sessionId);
  return entry?.sock || null;
}

function requireSocket(sessionId) {
  const sock = getSocket(sessionId);
  if (!sock) {
    const err = new Error(`Session "${sessionId}" is not connected`);
    err.statusCode = 409;
    throw err;
  }
  return sock;
}

function getStatus(sessionId) {
  return sessions.get(sessionId)?.status || 'not_started';
}

function listActiveSessions() {
  return Array.from(sessions.entries()).map(([sessionId, v]) => ({ sessionId, status: v.status }));
}

async function logoutSession(sessionId) {
  disabledSessions.add(sessionId);
  const timer = reconnectTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(sessionId);
  }
  const sock = getSocket(sessionId);
  if (sock) {
    try { await sock.logout(); } catch (err) { /* already disconnected */ }
  }
  sessions.delete(sessionId);
  await clearAuthState(sessionId);
  await sessionRepo.upsert(sessionId, { status: 'logged_out', qr: null });
}

async function deleteSession(sessionId) {
  // Set deletion barrier before closing the socket because the close event is asynchronous.
  disabledSessions.add(sessionId);
  const timer = reconnectTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(sessionId);
  }

  const entry = sessions.get(sessionId);
  if (entry) {
    entry.status = 'stopping';
    entry.reconnectAttempts = 0;
    try { entry.sock.end(undefined); } catch (err) { /* noop */ }
  }
  sessions.delete(sessionId);

  await Promise.all([
    clearAuthState(sessionId),
    sessionRepo.deleteBySessionId(sessionId),
    chatRepo.deleteAllForSession(sessionId),
    contactRepo.deleteAllForSession(sessionId),
    messageRepo.deleteAllForSession(sessionId),
    groupRepo.deleteAllForSession(sessionId),
  ]);
}

module.exports = { startSession, getSocket, requireSocket, getStatus, listActiveSessions, logoutSession, deleteSession };
