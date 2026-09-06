const sessionManager = require('../baileys/sessionManager');
const sessionRepo = require('../repositories/session.repo');
const { getSessionLogger } = require('../config/logger');

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

/** Checks whether phone numbers are registered on WhatsApp — uses Baileys' onWhatsApp (USync query under the hood). */
async function checkNumbers(req, res) {
  const { sessionId } = req.params;
  const { numbers } = req.body; // array of E.164-ish numbers, no +
  const sock = sessionManager.requireSocket(sessionId);
  const results = await sock.onWhatsApp(...numbers);
  res.json({ success: true, data: results });
}

module.exports = { start, status, list, logout, remove, checkNumbers };
