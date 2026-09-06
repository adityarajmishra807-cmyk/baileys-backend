const path = require('path');
const fs = require('fs');
const messageRepo = require('../repositories/message.repo');
const { ROOT } = require('../utils/mediaStorage');

/** Streams a downloaded media file back for a given message. */
async function download(req, res) {
  const { sessionId, jid, messageId } = req.params;
  const msg = await messageRepo.findOne(sessionId, jid, messageId);
  if (!msg?.mediaPath) return res.status(404).json({ success: false, error: 'No media stored for this message' });

  // Guard against path traversal — resolved path must stay under the media root.
  const resolved = path.resolve(msg.mediaPath);
  if (!resolved.startsWith(path.resolve(ROOT))) {
    return res.status(400).json({ success: false, error: 'Invalid media path' });
  }
  if (!fs.existsSync(resolved)) return res.status(404).json({ success: false, error: 'File no longer on disk' });

  if (msg.mediaMimetype) res.setHeader('Content-Type', msg.mediaMimetype);
  fs.createReadStream(resolved).pipe(res);
}

module.exports = { download };
