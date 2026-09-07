const chatRepo = require("../repositories/chat.repo");
const contactRepo = require("../repositories/contact.repo");
const messageRepo = require("../repositories/message.repo");
const groupRepo = require("../repositories/group.repo");
const lidMappingRepo = require("../repositories/lidMapping.repo");
const { saveIncomingMedia } = require("../utils/mediaStorage");

const MEDIA_TYPES = new Set(["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"]);
const GROUP_CACHE_TTL_MS = 5 * 60 * 1000;
const groupCache = new Map();

function groupCacheKey(sessionId, jid) { return `${sessionId}:${jid}`; }
function getCachedGroupMetadataFactory(sessionId) {
  return async (jid) => {
    const entry = groupCache.get(groupCacheKey(sessionId, jid));
    if (entry && Date.now() - entry.ts < GROUP_CACHE_TTL_MS) return entry.metadata;
    return undefined;
  };
}
function setGroupCache(sessionId, jid, metadata) { groupCache.set(groupCacheKey(sessionId, jid), { metadata, ts: Date.now() }); }
function toJSONSafe(obj) { return JSON.parse(JSON.stringify(obj)); }
function extractMessageType(message) {
  if (!message?.message) return message?.messageStubType ? "stub" : "unknown";
  const keys = Object.keys(message.message);
  return keys.find((k) => k !== "messageContextInfo") || keys[0] || "unknown";
}

async function persistContactMappings(sessionId, contacts, logger) {
  const mappings = (contacts || []).filter((c) => c?.lid && c?.phoneNumber).map((c) => ({ lid: c.lid, pn: c.phoneNumber }));
  if (!mappings.length) return;
  try { await lidMappingRepo.upsertMany(sessionId, mappings); }
  catch (err) { logger.warn({ err, count: mappings.length }, "contact LID mapping persist failed"); }
}

async function persistHistoryMessages(sessionId, messages) {
  const entries = [];
  const chatTouches = new Map();
  for (const m of messages || []) {
    if (!m.key?.remoteJid || !m.key?.id) continue;
    const type = extractMessageType(m);
    const ts = Number(m.messageTimestamp || Date.now() / 1000);
    entries.push({
      jid: m.key.remoteJid, messageId: m.key.id, fromMe: !!m.key.fromMe,
      participant: m.key.participant || m.participant || null, messageTimestamp: ts,
      messageType: type, mediaPath: null, mediaMimetype: null,
      quotedMessageId: m.message?.[type]?.contextInfo?.stanzaId || null,
      content: toJSONSafe(m), status: m.key.fromMe ? "sent" : "delivered",
    });
    const previous = chatTouches.get(m.key.remoteJid);
    if (!previous || ts >= previous.conversationTimestamp) chatTouches.set(m.key.remoteJid, { jid: m.key.remoteJid, lastMessageId: m.key.id, conversationTimestamp: ts });
  }
  if (entries.length) await messageRepo.upsertMany(sessionId, entries);
  for (const touch of chatTouches.values()) {
    await chatRepo.touchLastMessage(sessionId, touch.jid, { lastMessageId: touch.lastMessageId, conversationTimestamp: touch.conversationTimestamp });
  }
  return entries.length;
}

function bindStore(sock, sessionId, logger) {
  const ev = sock.ev;
  ev.on("chats.upsert", async (chats) => {
    try { await chatRepo.upsertMany(sessionId, chats.filter((c) => c?.id && !c.id.endsWith("@broadcast") && !c.id.endsWith("@newsletter"))); }
    catch (err) { logger.error({ err }, "chats.upsert persist failed"); }
  });
  ev.on("chats.update", async (updates) => {
    try { await chatRepo.upsertPartialMany(sessionId, updates); }
    catch (err) { logger.error({ err }, "chats.update persist failed"); }
  });
  ev.on("chats.delete", async (jids) => {
    try { await chatRepo.deleteMany(sessionId, jids); }
    catch (err) { logger.error({ err }, "chats.delete persist failed"); }
  });
  ev.on("contacts.upsert", async (contacts) => {
    try { await persistContactMappings(sessionId, contacts, logger); await contactRepo.upsertMany(sessionId, contacts); }
    catch (err) { logger.error({ err }, "contacts.upsert persist failed"); }
  });
  ev.on("contacts.update", async (updates) => {
    try { await persistContactMappings(sessionId, updates, logger); await contactRepo.upsertPartialMany(sessionId, updates); }
    catch (err) { logger.error({ err }, "contacts.update persist failed"); }
  });
  ev.on("messages.upsert", async ({ messages, type: upsertType }) => {
    try {
      const entries = [], chatTouches = new Map();
      for (const m of messages || []) {
        if (!m.key?.remoteJid || !m.key?.id) continue;
        const type = extractMessageType(m), ts = Number(m.messageTimestamp || Date.now() / 1000);
        let mediaInfo = null;
        if (upsertType === "notify" && MEDIA_TYPES.has(type)) mediaInfo = await saveIncomingMedia(sessionId, m, type, logger);
        entries.push({ jid: m.key.remoteJid, messageId: m.key.id, fromMe: !!m.key.fromMe, participant: m.key.participant || m.participant || null, messageTimestamp: ts, messageType: type, mediaPath: mediaInfo?.filePath || null, mediaMimetype: mediaInfo?.mimetype || null, quotedMessageId: m.message?.[type]?.contextInfo?.stanzaId || null, content: toJSONSafe(m), status: m.key.fromMe ? "sent" : "delivered" });
        const previous = chatTouches.get(m.key.remoteJid);
        if (!previous || ts >= previous.conversationTimestamp) chatTouches.set(m.key.remoteJid, { jid: m.key.remoteJid, lastMessageId: m.key.id, conversationTimestamp: ts });
      }
      if (entries.length) await messageRepo.upsertMany(sessionId, entries);
      for (const t of chatTouches.values()) await chatRepo.touchLastMessage(sessionId, t.jid, { lastMessageId: t.lastMessageId, conversationTimestamp: t.conversationTimestamp });
    } catch (err) { logger.error({ err }, "messages.upsert persist failed"); }
  });
  ev.on("messages.update", async (updates) => {
    try {
      for (const { key, update } of updates || []) {
        if (!key?.id) continue;
        const patch = {};
        if (update.status !== undefined) { const map = { 0: "failed", 1: "pending", 2: "sent", 3: "delivered", 4: "read", 5: "played" }; patch.status = map[update.status] || "sent"; }
        if (update.message === null) { patch.deleted = true; patch.status = "revoked"; }
        if (Object.keys(patch).length) await messageRepo.updateByKey(sessionId, key.remoteJid, key.id, patch);
      }
    } catch (err) { logger.error({ err }, "messages.update persist failed"); }
  });
  ev.on("messages.delete", async (item) => {
    try {
      if (item?.all) await messageRepo.markDeletedForChat(sessionId, item.jid);
      else if (item?.keys) await messageRepo.markDeletedByIds(sessionId, item.keys.map((k) => k.id));
    } catch (err) { logger.error({ err }, "messages.delete persist failed"); }
  });
  ev.on("groups.upsert", async (groups) => {
    try { for (const g of groups || []) { setGroupCache(sessionId, g.id, g); await groupRepo.upsertOne(sessionId, g); } }
    catch (err) { logger.error({ err }, "groups.upsert persist failed"); }
  });
  ev.on("groups.update", async (updates) => {
    try { for (const u of updates || []) { if (!u.id) continue; const existing = groupCache.get(groupCacheKey(sessionId, u.id)); const merged = { ...(existing?.metadata || {}), ...u }; setGroupCache(sessionId, u.id, merged); await groupRepo.upsertPartial(sessionId, u.id, u); } }
    catch (err) { logger.error({ err }, "groups.update persist failed"); }
  });
  ev.on("group-participants.update", async ({ id, participants, action }) => {
    try {
      const group = await groupRepo.findOne(sessionId, id); if (!group) return;
      let list = group.participants || [];
      if (action === "add") for (const p of participants) if (!list.find((x) => x.id === p)) list.push({ id: p, admin: null });
      else if (action === "remove") list = list.filter((x) => !participants.includes(x.id));
      else if (action === "promote") list = list.map((x) => participants.includes(x.id) ? { ...x, admin: "admin" } : x);
      else if (action === "demote") list = list.map((x) => participants.includes(x.id) ? { ...x, admin: null } : x);
      await groupRepo.updateParticipants(sessionId, id, list); groupCache.delete(groupCacheKey(sessionId, id));
    } catch (err) { logger.error({ err }, "group-participants.update persist failed"); }
  });
  ev.on("messaging-history.set", async ({ chats, contacts, messages, isLatest, syncType, lidPnMappings }) => {
    const startedAt = Date.now();
    const chatList = (chats || []).filter((c) => c?.id && !c.id.endsWith("@broadcast") && !c.id.endsWith("@newsletter"));
    try {
      logger.info({ chats: chatList.length, contacts: contacts?.length || 0, messages: messages?.length || 0, lidPnMappings: lidPnMappings?.length || 0, isLatest, syncType }, "messaging-history.set received");

      // Identity mapping is useful metadata, but it must never prevent the core
      // chat/message history from being persisted when Supabase has a transient
      // mapping-table/network failure.
      if (lidPnMappings?.length) {
        try { await lidMappingRepo.upsertMany(sessionId, lidPnMappings); }
        catch (err) { logger.warn({ err, count: lidPnMappings.length }, "history LID mapping persist failed; continuing history sync"); }
      }

      if (chatList.length) await chatRepo.upsertMany(sessionId, chatList);
      if (contacts?.length) { await persistContactMappings(sessionId, contacts, logger); await contactRepo.upsertMany(sessionId, contacts); }
      const persistedMessages = await persistHistoryMessages(sessionId, messages || []);
      logger.info({ persistedChats: chatList.length, persistedContacts: contacts?.length || 0, persistedMessages, durationMs: Date.now() - startedAt, isLatest, syncType }, "messaging-history.set persisted");
    } catch (err) {
      logger.error({ err, receivedChats: chatList.length, receivedContacts: contacts?.length || 0, receivedMessages: messages?.length || 0, durationMs: Date.now() - startedAt }, "messaging-history.set persist failed");
    }
  });
  ev.on("blocklist.set", ({ blocklist }) => logger.info({ count: blocklist.length }, "blocklist.set received"));
  ev.on("blocklist.update", ({ blocklist, type }) => logger.info({ blocklist, type }, "blocklist.update received"));
}

module.exports = { bindStore, getCachedGroupMetadataFactory, setGroupCache, groupCache };
