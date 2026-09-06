const sessionManager = require('../baileys/sessionManager');
const contactRepo = require('../repositories/contact.repo');

async function list(req, res) {
  const { sessionId } = req.params;
  const contacts = await contactRepo.findAll(sessionId);
  res.json({ success: true, data: contacts });
}

async function profilePicture(req, res) {
  const { sessionId, jid } = req.params;
  const { highRes } = req.query;
  const sock = sessionManager.requireSocket(sessionId);
  try {
    const url = await sock.profilePictureUrl(jid, highRes === 'true' ? 'image' : 'preview');
    res.json({ success: true, data: { url } });
  } catch (err) {
    res.json({ success: true, data: { url: null } }); // no picture set / privacy restricted
  }
}

async function status(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const result = await sock.fetchStatus(jid);
  res.json({ success: true, data: result });
}

async function businessProfile(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const result = await sock.getBusinessProfile(jid);
  res.json({ success: true, data: result || null });
}

module.exports = { list, profilePicture, status, businessProfile };
