const path = require('path');
const fs = require('fs');
const messageRepo = require('../repositories/message.repo');
const { ROOT } = require('../utils/mediaStorage');
const env = require('../config/env');
const { verifyToken } = require('../sockets/token');

function isAuthorized(req, sessionId) {
  if (!env.API_KEY) return true;

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (token === env.API_KEY) return true;

  const realtimeToken = String(req.query.realtimeToken || '');
  if (!realtimeToken) return false;
  const verified = verifyToken(realtimeToken);
  return Boolean(verified?.sessionIds?.has(sessionId));
}

/** Streams a downloaded media file back for a given message. */
async function download(req, res) {
  const { sessionId, jid, messageId } = req.params;
  if (!isAuthorized(req, sessionId)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const msg = await messageRepo.findOne(sessionId, jid, messageId);
  if (!msg?.mediaPath) return res.status(404).json({ success: false, error: 'No media stored for this message' });

  const resolved = path.resolve(msg.mediaPath);
  if (!resolved.startsWith(path.resolve(ROOT))) {
    return res.status(400).json({ success: false, error: 'Invalid media path' });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ success: false, error: 'File no longer on disk' });

  if (msg.mediaMimetype) res.setHeader('Content-Type', msg.mediaMimetype);
  const stat = fs.statSync(resolved);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(resolved).pipe(res);
}

module.exports = { download };