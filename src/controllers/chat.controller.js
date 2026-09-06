const sessionManager = require('../baileys/sessionManager');
const chatRepo = require('../repositories/chat.repo');
const messageRepo = require('../repositories/message.repo');
const contactRepo = require('../repositories/contact.repo');

function resolveDisplayName(chat, contact) {
  if (chat.isGroup) return chat.name || contact?.name || 'Group';
  return (
    contact?.name ||          // saved in phone contacts
    contact?.verifiedName ||  // business account verified name
    contact?.notify ||        // the "push name" the person set themselves
    chat.name ||
    chat.jid.split('@')[0]    // last resort: phone number
  );
}


async function list(req, res) {
  const { sessionId } = req.params;
  const [chats, contacts] = await Promise.all([
    chatRepo.findAll(sessionId),
    contactRepo.findAll(sessionId),
  ]);
  const contactMap = new Map(contacts.map((c) => [c.jid, c]));
  const data = chats.map((chat) => ({
    ...chat,
    displayName: resolveDisplayName(chat, contactMap.get(chat.jid)),
  }));
  res.json({ success: true, data });
}

async function get(req, res) {
  const { sessionId, jid } = req.params;
  const [chat, contact] = await Promise.all([
    chatRepo.findOne(sessionId, jid),
    contactRepo.findOne(sessionId, jid),
  ]);
  if (!chat) return res.status(404).json({ success: false, error: 'Chat not found' });
  res.json({ success: true, data: { ...chat, displayName: resolveDisplayName(chat, contact) } });
}

async function updateChatModifier(req, res) {
  const { sessionId, jid } = req.params;
  const { action, value } = req.body; // action: 'archive' | 'pin' | 'mute' | 'markRead' | 'markUnread'
  const sock = sessionManager.requireSocket(sessionId);
  const lastMsg = await messageRepo.findLatest(sessionId, jid);
  const lastMessages = lastMsg ? [lastMsg.content] : [];

  switch (action) {
    case 'archive':
      await sock.chatModify({ archive: !!value, lastMessages }, jid);
      break;
    case 'pin':
      await sock.chatModify({ pin: !!value }, jid);
      break;
    case 'mute':
      // value: duration in ms, or null to unmute
      await sock.chatModify({ mute: value ? Date.now() + Number(value) : null }, jid);
      break;
    case 'markRead':
      await sock.chatModify({ markRead: true, lastMessages }, jid);
      break;
    case 'markUnread':
      await sock.chatModify({ markRead: false, lastMessages }, jid);
      break;
    default:
      return res.status(400).json({ success: false, error: 'Unknown action' });
  }
  res.json({ success: true });
}

async function remove(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const lastMsg = await messageRepo.findLatest(sessionId, jid);
  await sock.chatModify({ delete: true, lastMessages: lastMsg ? [lastMsg.content] : [] }, jid);
  await chatRepo.deleteOne(sessionId, jid);
  res.json({ success: true });
}

async function clearMessages(req, res) {
  const { sessionId, jid } = req.params;
  const sock = sessionManager.requireSocket(sessionId);
  const msgs = await messageRepo.findAllForChat(sessionId, jid);
  await sock.chatModify(
    { clear: true, lastMessages: msgs.map((m) => ({ key: m.content.key, messageTimestamp: m.messageTimestamp })) },
    jid
  );
  await messageRepo.deleteAllForChat(sessionId, jid);
  res.json({ success: true });
}

module.exports = { list, get, updateChatModifier, remove, clearMessages };
