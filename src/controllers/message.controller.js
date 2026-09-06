const sessionManager = require('../baileys/sessionManager');
const { sendMessage, editMessage, deleteMessage } = require('../baileys/messageSender');
const { saveOutgoingUpload } = require('../utils/mediaStorage');
const messageRepo = require('../repositories/message.repo');

/**
 * Send any message type. For media types, either upload a file (multipart,
 * field name "file") or pass a public `url` in the body — matches Baileys'
 * AnyMessageContent, which accepts { url } / { stream } / { buffer } sources.
 */
async function send(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);

  let filePath;
  if (req.file) {
    filePath = saveOutgoingUpload(sessionId, req.file);
  }

  let quoted;
  if (req.body.quotedMessageId) {
    const msg = await messageRepo.findOne(sessionId, jid, req.body.quotedMessageId);
    quoted = msg?.content;
  }

  const result = await sendMessage(sock, jid, { ...req.body, quoted }, filePath);
  res.status(201).json({ success: true, data: result });
}

async function edit(req, res) {
  const { sessionId, jid, messageId } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const msg = await messageRepo.findOne(sessionId, jid, messageId);
  if (!msg) return res.status(404).json({ success: false, error: 'Message not found' });
  const result = await editMessage(sock, jid, msg.content.key, req.body.text);
  res.json({ success: true, data: result });
}

async function remove(req, res) {
  const { sessionId, jid, messageId } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const msg = await messageRepo.findOne(sessionId, jid, messageId);
  if (!msg) return res.status(404).json({ success: false, error: 'Message not found' });
  const result = await deleteMessage(sock, jid, msg.content.key);
  res.json({ success: true, data: result });
}

async function react(req, res) {
  const { sessionId, jid, messageId } = req.params;
  const { emoji } = req.body;
  const sock = sessionManager.requireSocket(sessionId);
  const msg = await messageRepo.findOne(sessionId, jid, messageId);
  if (!msg) return res.status(404).json({ success: false, error: 'Message not found' });
  const result = await sock.sendMessage(jid, { react: { text: emoji, key: msg.content.key } });
  res.json({ success: true, data: result });
}

/** Marks one or more messages as read — required so WhatsApp shows blue ticks and stops re-delivering. */
async function markRead(req, res) {
  const { sessionId, jid } = req.params;
  const { messageIds } = req.body;
  const sock = sessionManager.requireSocket(sessionId);
  const msgs = await messageRepo.findMany(sessionId, jid, messageIds);
  const keys = msgs.map((m) => m.content.key);
  await sock.readMessages(keys);
  res.json({ success: true });
}

async function history(req, res) {
  const { sessionId, jid } = req.params;
  const { before, limit = 50 } = req.query;
  const msgs = await messageRepo.findHistory(sessionId, jid, { before, limit });
  res.json({ success: true, data: msgs.reverse() });
}

module.exports = { send, edit, remove, react, markRead, history };
