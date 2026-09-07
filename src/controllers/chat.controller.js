const sessionManager = require('../baileys/sessionManager');
const chatRepo = require('../repositories/chat.repo');
const messageRepo = require('../repositories/message.repo');
const contactRepo = require('../repositories/contact.repo');
const lidMappingRepo = require('../repositories/lidMapping.repo');

function resolveDisplayName(chat, contact) {
  if (chat.isGroup) return chat.name || contact?.name || 'Group';
  return contact?.name || contact?.verifiedName || contact?.notify || chat.name || chat.phoneNumber || chat.jid.split('@')[0];
}

function indexContacts(contacts) {
  const map = new Map();
  for (const contact of contacts || []) if (contact?.jid) map.set(contact.jid, contact);
  return map;
}

async function enrichChats(sessionId, rows) {
  if (!rows.length) return [];

  const lidJids = rows.map((chat) => chat.jid).filter((jid) => lidMappingRepo.isLidJid(jid));
  const mappings = await lidMappingRepo.findManyByLids(sessionId, lidJids);
  const mappingMap = new Map(mappings.map((m) => [m.lid_jid, m]));

  const contacts = await contactRepo.findAll(sessionId);
  const contactMap = indexContacts(contacts);

  return rows.map((row) => {
    const mapping = mappingMap.get(row.jid);
    const chat = {
      ...row,
      phoneJid: mapping?.phone_jid || row.phoneJid,
      phoneNumber: mapping?.phone_jid ? mapping.phone_jid.split('@')[0].split(':')[0] : row.phoneNumber,
    };
    const contact = contactMap.get(row.jid) || (mapping?.phone_jid ? contactMap.get(mapping.phone_jid) : null);
    return { ...chat, displayName: resolveDisplayName(chat, contact) };
  });
}

function chatRepoRowToCamel(row) {
  const isLid = row.jid?.endsWith('@lid') || row.jid?.endsWith('@hosted.lid');
  return {
    sessionId: row.session_id,
    jid: row.jid,
    phoneJid: isLid ? null : row.jid,
    phoneNumber: !isLid && row.jid ? row.jid.split('@')[0].split(':')[0] : null,
    isLid,
    name: row.name,
    unreadCount: row.unread_count,
    conversationTimestamp: Number(row.conversation_timestamp),
    pinned: row.pinned,
    archived: row.archived,
    muteEndTime: Number(row.mute_end_time),
    isGroup: row.is_group,
    lastMessageId: row.last_message_id,
    raw: row.raw,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function list(req, res) {
  const { sessionId } = req.params;
  const { limit = 50, before } = req.query;
  const page = await chatRepo.findPage(sessionId, { limit, before });
  const data = await enrichChats(sessionId, page.rows.map(chatRepoRowToCamel));
  res.json({
    success: true,
    data,
    pagination: {
      limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    },
  });
}

async function get(req, res) {
  const { sessionId, jid } = req.params;
  const [chat, contact] = await Promise.all([chatRepo.findOne(sessionId, jid), contactRepo.findOne(sessionId, jid)]);
  if (!chat) return res.status(404).json({ success: false, error: 'Chat not found' });

  let mapping = null;
  if (lidMappingRepo.isLidJid(jid)) mapping = await lidMappingRepo.findByLid(sessionId, jid);
  const normalized = {
    ...chat,
    phoneJid: mapping?.phone_jid || chat.phoneJid,
    phoneNumber: mapping?.phone_jid ? mapping.phone_jid.split('@')[0].split(':')[0] : chat.phoneNumber,
  };
  const resolvedContact = contact || (mapping?.phone_jid ? await contactRepo.findOne(sessionId, mapping.phone_jid) : null);
  res.json({ success: true, data: { ...normalized, displayName: resolveDisplayName(normalized, resolvedContact) } });
}

async function updateChatModifier(req, res) {
  const { sessionId, jid } = req.params;
  const { action, value } = req.body;
  const sock = sessionManager.requireSocket(sessionId);
  const lastMsg = await messageRepo.findLatest(sessionId, jid);
  const lastMessages = lastMsg ? [lastMsg.content] : [];

  switch (action) {
    case 'archive': await sock.chatModify({ archive: !!value, lastMessages }, jid); break;
    case 'pin': await sock.chatModify({ pin: !!value }, jid); break;
    case 'mute': await sock.chatModify({ mute: value ? Date.now() + Number(value) : null }, jid); break;
    case 'markRead': await sock.chatModify({ markRead: true, lastMessages }, jid); break;
    case 'markUnread': await sock.chatModify({ markRead: false, lastMessages }, jid); break;
    default: return res.status(400).json({ success: false, error: 'Unknown action' });
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
  await sock.chatModify({ clear: true, lastMessages: msgs.map((m) => ({ key: m.content.key, messageTimestamp: m.messageTimestamp })) }, jid);
  await messageRepo.deleteAllForChat(sessionId, jid);
  res.json({ success: true });
}

module.exports = { list, get, updateChatModifier, remove, clearMessages };
