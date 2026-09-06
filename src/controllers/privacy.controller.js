const sessionManager = require('../baileys/sessionManager');

async function getSettings(req, res) {
  const { sessionId } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const settings = await sock.fetchPrivacySettings(true);
  res.json({ success: true, data: settings });
}

/**
 * field: 'readreceipts' | 'profile' | 'status' | 'online' | 'last' | 'groupadd' | 'calladd'
 * value depends on the field, e.g. 'all' | 'contacts' | 'contact_blacklist' | 'none' | 'match_last_seen'
 */
async function updateSetting(req, res) {
  const { sessionId } = req.params;
  const { field, value } = req.body;
  const sock = sessionManager.requireSocket(sessionId);

  const map = {
    readreceipts: sock.updateReadReceiptsPrivacy,
    profile: sock.updateProfilePicturePrivacy,
    status: sock.updateStatusPrivacy,
    online: sock.updateOnlinePrivacy,
    last: sock.updateLastSeenPrivacy,
    groupadd: sock.updateGroupsAddPrivacy,
    calladd: sock.updateCallPrivacy,
  };
  const fn = map[field];
  if (!fn) return res.status(400).json({ success: false, error: `Unknown privacy field: ${field}` });
  await fn.call(sock, value);
  res.json({ success: true });
}

async function updateDisappearingDefault(req, res) {
  const { sessionId } = req.params;
  const { seconds } = req.body; // default disappearing-message timer for new chats
  const sock = sessionManager.requireSocket(sessionId);
  await sock.updateDefaultDisappearingMode(seconds);
  res.json({ success: true });
}

async function getBlocklist(req, res) {
  const { sessionId } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const list = await sock.fetchBlocklist();
  res.json({ success: true, data: list });
}

async function block(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  await sock.updateBlockStatus(jid, 'block');
  res.json({ success: true });
}

async function unblock(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  await sock.updateBlockStatus(jid, 'unblock');
  res.json({ success: true });
}

module.exports = { getSettings, updateSetting, updateDisappearingDefault, getBlocklist, block, unblock };
