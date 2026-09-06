const sessionManager = require('../baileys/sessionManager');
const sessionRepo = require('../repositories/session.repo');
const { getSessionLogger } = require('../config/logger');
const { createToken } = require('../sockets/token');

async function start(req, res) {
  const { sessionId } = req.params;
  const logger = getSessionLogger(sessionId);
  logger.info('Start session requested');
  await sessionManager.startSession(sessionId, req.app.get('io'));
  res.status(202).json({ success: true, message: 'Session starting — subscribe to socket.io room `session:' + sessionId + '` for the QR code.' });
}

async function status(req, res) {
  const { sessionId } = req.params;
  const doc = await sessionRepo.findBySessionId(sessionId);
  res.json({
    success: true,
    data: {
      sessionId,
      status: sessionManager.getStatus(sessionId) !== 'not_started' ? sessionManager.getStatus(sessionId) : doc?.status || 'not_started',
      qr: doc?.status === 'qr' ? doc.qr : null,
      me: doc?.me || null,
      lastConnectedAt: doc?.lastConnectedAt || null,
    },
  });
}

async function list(req, res) {
  const docs = await sessionRepo.findAll();
  res.json({ success: true, data: docs });
}

async function realtimeToken(req, res) {
  const ids = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds : [];
  const sessionIds = ids.filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(id));
  if (!sessionIds.length) return res.status(400).json({ success: false, error: 'sessionIds must contain at least one valid session ID' });
  res.json({ success: true, data: { token: createToken(sessionIds) } });
}

async function logout(req, res) {
  const { sessionId } = req.params;
  await sessionManager.logoutSession(sessionId);
  res.json({ success: true, message: 'Logged out' });
}

async function remove(req, res) {
  const { sessionId } = req.params;
  await sessionManager.deleteSession(sessionId);
  res.json({ success: true, message: 'Session and all its data deleted' });
}

async function checkNumbers(req, res) {
  const { sessionId } = req.params;
  const { numbers } = req.body;
  const sock = sessionManager.requireSocket(sessionId);
  const results = await sock.onWhatsApp(...numbers);
  res.json({ success: true, data: results });
}

module.exports = { start, status, list, realtimeToken, logout, remove, checkNumbers };
