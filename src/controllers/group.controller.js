const sessionManager = require('../baileys/sessionManager');
const groupRepo = require('../repositories/group.repo');
const { setGroupCache } = require('../baileys/store');

async function create(req, res) {
  const { sessionId } = req.params;
  const { subject, participants } = req.body; // participants: array of jids
  const sock = sessionManager.requireSocket(sessionId);
  const group = await sock.groupCreate(subject, participants);
  setGroupCache(sessionId, group.id, group);
  res.status(201).json({ success: true, data: group });
}

async function list(req, res) {
  const { sessionId } = req.params;
  const groups = await groupRepo.findAll(sessionId);
  res.json({ success: true, data: groups });
}

async function metadata(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const meta = await sock.groupMetadata(jid);
  setGroupCache(sessionId, jid, meta);
  res.json({ success: true, data: meta });
}

async function updateSubject(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  await sock.groupUpdateSubject(jid, req.body.subject);
  res.json({ success: true });
}

async function updateDescription(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  await sock.groupUpdateDescription(jid, req.body.description);
  res.json({ success: true });
}

/** action: add | remove | promote | demote */
async function participants(req, res) {
  const { sessionId, jid } = req.params;
  const { action, participants: jids } = req.body;
  const sock = sessionManager.requireSocket(sessionId);
  const result = await sock.groupParticipantsUpdate(jid, jids, action);
  res.json({ success: true, data: result });
}

/** setting: announcement (only admins send) | not_announcement | locked (only admins edit info) | unlocked */
async function updateSetting(req, res) {
  const { sessionId, jid } = req.params;
  const { setting } = req.body;
  const sock = sessionManager.requireSocket(sessionId);
  await sock.groupSettingUpdate(jid, setting);
  res.json({ success: true });
}

async function inviteCode(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const code = await sock.groupInviteCode(jid);
  res.json({ success: true, data: { code, url: `https://chat.whatsapp.com/${code}` } });
}

async function revokeInviteCode(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const code = await sock.groupRevokeInvite(jid);
  res.json({ success: true, data: { code } });
}

async function joinViaInvite(req, res) {
  const { sessionId } = req.params;
  const { code } = req.body; // full link or just the code
  const inviteCodeOnly = code.includes('chat.whatsapp.com/') ? code.split('/').pop() : code;
  const sock = sessionManager.requireSocket(sessionId);
  const jid = await sock.groupAcceptInvite(inviteCodeOnly);
  res.json({ success: true, data: { jid } });
}

async function leave(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  await sock.groupLeave(jid);
  await groupRepo.deleteOne(sessionId, jid);
  res.json({ success: true });
}

async function ephemeral(req, res) {
  const { sessionId, jid } = req.params;
  const { seconds } = req.body; // 0 = off, 86400, 604800, 7776000
  const sock = sessionManager.requireSocket(sessionId);
  await sock.groupToggleEphemeral(jid, seconds);
  res.json({ success: true });
}

module.exports = {
  create,
  list,
  metadata,
  updateSubject,
  updateDescription,
  participants,
  updateSetting,
  inviteCode,
  revokeInviteCode,
  joinViaInvite,
  leave,
  ephemeral,
};
