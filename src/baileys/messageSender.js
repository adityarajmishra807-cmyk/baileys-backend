const fs = require('fs');

/**
 * Builds the Baileys `AnyMessageContent` payload for a given request body.
 * `body.type` selects the message kind; `filePath` is set by the media
 * controller after handling the multipart upload (if any).
 */
function buildContent(body, filePath) {
  const {
    type, text, caption, mimetype, fileName, url,
    latitude, longitude, address,
    displayName, vcard,
    pollName, pollOptions, pollSelectableCount,
    seconds, ptt,
    contextInfo,
  } = body;

  const mediaSource = filePath ? { url: filePath } : (url ? { url } : undefined);

  switch (type) {
    case 'text':
      return { text, contextInfo };
    case 'image':
      return { image: mediaSource, caption, mimetype, contextInfo };
    case 'video':
      return { video: mediaSource, caption, mimetype, gifPlayback: !!body.gifPlayback, contextInfo };
    case 'audio':
      return { audio: mediaSource, mimetype: mimetype || 'audio/mp4', ptt: !!ptt, contextInfo };
    case 'document':
      return { document: mediaSource, mimetype: mimetype || 'application/octet-stream', fileName, caption, contextInfo };
    case 'sticker':
      return { sticker: mediaSource, contextInfo };
    case 'location':
      return { location: { degreesLatitude: latitude, degreesLongitude: longitude, address }, contextInfo };
    case 'contact':
      return {
        contacts: {
          displayName,
          contacts: [{ vcard }],
        },
        contextInfo,
      };
    case 'poll':
      return {
        poll: {
          name: pollName,
          values: pollOptions,
          selectableCount: pollSelectableCount || 1,
        },
        contextInfo,
      };
    case 'reaction':
      return {
        react: { text: body.emoji, key: body.reactToKey },
      };
    default:
      throw Object.assign(new Error(`Unsupported message type: ${type}`), { statusCode: 400 });
  }
}

/**
 * Sends a message via the given socket. Handles quoting (`quotedMessageId`),
 * disappearing-message contextInfo passthrough, and disk cleanup for
 * uploaded media once WhatsApp has accepted the send.
 */
async function sendMessage(sock, jid, body, filePath) {
  const content = buildContent(body, filePath);
  const options = {};
  if (body.quoted) options.quoted = body.quoted; // full quoted WAMessage object, fetched by controller
  const result = await sock.sendMessage(jid, content, options);

  if (filePath) {
    fs.promises.unlink(filePath).catch(() => {}); // best-effort cleanup of temp upload
  }
  return result;
}

/** Edits a previously-sent text message (Baileys `edit` message type). */
async function editMessage(sock, jid, key, newText) {
  return sock.sendMessage(jid, { text: newText, edit: key });
}

/** Deletes/revokes a message for everyone. */
async function deleteMessage(sock, jid, key) {
  return sock.sendMessage(jid, { delete: key });
}

module.exports = { buildContent, sendMessage, editMessage, deleteMessage };
