const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const env = require('../config/env');

const ROOT = path.resolve(env.MEDIA_STORAGE_PATH);

function sessionDir(sessionId) {
  const dir = path.join(ROOT, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const EXT_BY_TYPE = {
  imageMessage: 'jpg',
  videoMessage: 'mp4',
  audioMessage: 'ogg',
  documentMessage: 'bin',
  stickerMessage: 'webp',
};

/**
 * Downloads media from an incoming Baileys message and stores it on local
 * disk under `<MEDIA_STORAGE_PATH>/<sessionId>/<messageId>.<ext>`.
 * Returns { filePath, mimetype } or null if the message has no media.
 */
async function saveIncomingMedia(sessionId, msg, messageType, logger) {
  if (!EXT_BY_TYPE[messageType]) return null;
  try {
    const buffer = await downloadMediaMessage(
      msg,
      'buffer',
      {},
      { logger, reuploadRequest: undefined }
    );
    const mediaNode = msg.message[messageType];
    const ext = mediaNode?.mimetype?.split('/')?.[1]?.split(';')?.[0] || EXT_BY_TYPE[messageType];
    const dir = sessionDir(sessionId);
    const fileName = `${msg.key.id}.${ext}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buffer);
    return { filePath, mimetype: mediaNode?.mimetype || null, fileName };
  } catch (err) {
    logger?.error({ err }, 'Failed to download/save incoming media');
    return null;
  }
}

/** Saves a multer-uploaded file buffer for outgoing media, returns its absolute path. */
function saveOutgoingUpload(sessionId, file) {
  const dir = sessionDir(sessionId);
  const safeName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${file.originalname.replace(/[^\w.\-]/g, '_')}`;
  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, file.buffer);
  return filePath;
}

module.exports = { saveIncomingMedia, saveOutgoingUpload, sessionDir, ROOT };
