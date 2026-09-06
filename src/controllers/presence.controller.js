const sessionManager = require('../baileys/sessionManager');

/** Subscribes to a contact's presence — required before WhatsApp will push presence.update events for them. */
async function subscribe(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  await sock.presenceSubscribe(jid);
  res.json({ success: true });
}

/**
 * state: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused'
 * jid optional — omit to set global presence, provide to show typing/recording in a specific chat.
 */
async function update(req, res) {
  const { sessionId } = req.params;
  const { state, jid } = req.body;
  const sock = sessionManager.requireSocket(sessionId);
  await sock.sendPresenceUpdate(state, jid);
  res.json({ success: true });
}

module.exports = { subscribe, update };
