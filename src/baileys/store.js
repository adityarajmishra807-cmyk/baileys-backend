const chatRepo = require("../repositories/chat.repo");
const contactRepo = require("../repositories/contact.repo");
const messageRepo = require("../repositories/message.repo");
const groupRepo = require("../repositories/group.repo");
const { saveIncomingMedia } = require("../utils/mediaStorage");

const MEDIA_TYPES = new Set([
  "imageMessage",
  "videoMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
]);

// In-process cache of group metadata, keyed by "sessionId:jid".
// Passed to makeWASocket as `cachedGroupMetadata` so Baileys doesn't have to
// hit WhatsApp for group participant lists on every send/decrypt — this is
// the #1 recommended perf optimization in the Baileys docs.
const GROUP_CACHE_TTL_MS = 5 * 60 * 1000;
const groupCache = new Map();

function groupCacheKey(sessionId, jid) {
  return `${sessionId}:${jid}`;
}

function getCachedGroupMetadataFactory(sessionId) {
  return async (jid) => {
    const entry = groupCache.get(groupCacheKey(sessionId, jid));
    if (entry && Date.now() - entry.ts < GROUP_CACHE_TTL_MS)
      return entry.metadata;
    return undefined;
  };
}

function setGroupCache(sessionId, jid, metadata) {
  groupCache.set(groupCacheKey(sessionId, jid), { metadata, ts: Date.now() });
}

function toJSONSafe(obj) {
  // Strips proto Long/Buffer weirdness so it stores cleanly in a jsonb column.
  return JSON.parse(JSON.stringify(obj));
}

function extractMessageType(message) {
  if (!message?.message) return message?.messageStubType ? "stub" : "unknown";
  const keys = Object.keys(message.message);
  return keys.find((k) => k !== "messageContextInfo") || keys[0] || "unknown";
}

/**
 * Binds all persistence-relevant Baileys events for a socket to Supabase.
 * This is the "data store" layer replacing the deprecated in-memory store.
 */
function bindStore(sock, sessionId, logger) {
  const ev = sock.ev;

  // ---- Chats ----
  ev.on('chats.upsert', async (chats) => {
  try {
    const realChats = chats.filter(
      (c) => !c.id.endsWith('@broadcast') && !c.id.endsWith('@newsletter')
    );
    await chatRepo.upsertMany(sessionId, realChats);
  } catch (err) {
    logger.error({ err }, 'chats.upsert persist failed');
  }
});

  ev.on("chats.update", async (updates) => {
    try {
      await chatRepo.upsertPartialMany(sessionId, updates);
    } catch (err) {
      logger.error({ err }, "chats.update persist failed");
    }
  });

  ev.on("chats.delete", async (jids) => {
    try {
      await chatRepo.deleteMany(sessionId, jids);
    } catch (err) {
      logger.error({ err }, "chats.delete persist failed");
    }
  });

  // ---- Contacts ----
  ev.on("contacts.upsert", async (contacts) => {
    try {
      await contactRepo.upsertMany(sessionId, contacts);
    } catch (err) {
      logger.error({ err }, "contacts.upsert persist failed");
    }
  });

  ev.on("contacts.update", async (updates) => {
    try {
      await contactRepo.upsertPartialMany(sessionId, updates);
    } catch (err) {
      logger.error({ err }, "contacts.update persist failed");
    }
  });

  // ---- Messages ----
  ev.on("messages.upsert", async ({ messages, type: upsertType }) => {
    try {
      const entries = [];
      const chatTouches = [];
      for (const m of messages) {
        if (!m.key?.remoteJid || !m.key?.id) continue;
        const type = extractMessageType(m);
        const ts = Number(m.messageTimestamp || Date.now() / 1000);

        // Auto-download media only for live incoming messages (not bulk history
        // replay) to avoid hammering disk/bandwidth on first-ever sync.
        let mediaInfo = null;
        if (upsertType === "notify" && MEDIA_TYPES.has(type)) {
          mediaInfo = await saveIncomingMedia(sessionId, m, type, logger);
        }

        entries.push({
          jid: m.key.remoteJid,
          messageId: m.key.id,
          fromMe: !!m.key.fromMe,
          participant: m.key.participant || m.participant || null,
          messageTimestamp: ts,
          messageType: type,
          mediaPath: mediaInfo?.filePath || null,
          mediaMimetype: mediaInfo?.mimetype || null,
          quotedMessageId: m.message?.[type]?.contextInfo?.stanzaId || null,
          content: toJSONSafe(m),
          status: m.key.fromMe ? "sent" : "delivered",
        });

        chatTouches.push({
          jid: m.key.remoteJid,
          lastMessageId: m.key.id,
          conversationTimestamp: ts,
        });
      }
      if (entries.length) await messageRepo.upsertMany(sessionId, entries);
      // touchLastMessage upserts + creates the chat row if it doesn't exist yet,
      // matching the original $set + $setOnInsert(isGroup) bulk-write behavior.
      for (const t of chatTouches) {
        await chatRepo.touchLastMessage(sessionId, t.jid, {
          lastMessageId: t.lastMessageId,
          conversationTimestamp: t.conversationTimestamp,
        });
      }
    } catch (err) {
      logger.error({ err }, "messages.upsert persist failed");
    }
  });

  ev.on("messages.update", async (updates) => {
    try {
      for (const { key, update } of updates) {
        if (!key?.id) continue;
        const patch = {};
        if (update.status !== undefined) {
          // Baileys WAMessageStatus: 0 error,1 pending,2 server_ack,3 delivery_ack,4 read,5 played
          const map = {
            0: "failed",
            1: "pending",
            2: "sent",
            3: "delivered",
            4: "read",
            5: "played",
          };
          patch.status = map[update.status] || "sent";
        }
        if (update.message === null) {
          patch.deleted = true;
          patch.status = "revoked";
        }
        if (Object.keys(patch).length) {
          await messageRepo.updateByKey(
            sessionId,
            key.remoteJid,
            key.id,
            patch,
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "messages.update persist failed");
    }
  });

  ev.on("messages.delete", async (item) => {
    try {
      if ("all" in item && item.all) {
        await messageRepo.markDeletedForChat(sessionId, item.jid);
      } else if (item.keys) {
        await messageRepo.markDeletedByIds(
          sessionId,
          item.keys.map((k) => k.id),
        );
      }
    } catch (err) {
      logger.error({ err }, "messages.delete persist failed");
    }
  });

  // ---- Groups ----
  ev.on("groups.upsert", async (groups) => {
    try {
      for (const g of groups) {
        setGroupCache(sessionId, g.id, g);
        await groupRepo.upsertOne(sessionId, g);
      }
    } catch (err) {
      logger.error({ err }, "groups.upsert persist failed");
    }
  });

  ev.on("groups.update", async (updates) => {
    try {
      for (const u of updates) {
        if (!u.id) continue;
        const existing = groupCache.get(groupCacheKey(sessionId, u.id));
        const merged = { ...(existing?.metadata || {}), ...u };
        setGroupCache(sessionId, u.id, merged);
        await groupRepo.upsertPartial(sessionId, u.id, u);
      }
    } catch (err) {
      logger.error({ err }, "groups.update persist failed");
    }
  });

  ev.on("group-participants.update", async ({ id, participants, action }) => {
    try {
      logger.info(
        { groupId: id, participants, action },
        "group-participants.update",
      );
      const group = await groupRepo.findOne(sessionId, id);
      if (!group) return;
      let list = group.participants || [];
      if (action === "add") {
        for (const p of participants)
          if (!list.find((x) => x.id === p)) list.push({ id: p, admin: null });
      } else if (action === "remove") {
        list = list.filter((x) => !participants.includes(x.id));
      } else if (action === "promote") {
        list = list.map((x) =>
          participants.includes(x.id) ? { ...x, admin: "admin" } : x,
        );
      } else if (action === "demote") {
        list = list.map((x) =>
          participants.includes(x.id) ? { ...x, admin: null } : x,
        );
      }
      await groupRepo.updateParticipants(sessionId, id, list);
      groupCache.delete(groupCacheKey(sessionId, id)); // force refresh next read
    } catch (err) {
      logger.error({ err }, "group-participants.update persist failed");
    }
  });

  // ---- History sync ----
  // Fires once (possibly in several chunks) after connecting when Baileys pulls
  // the on-device chat/message/contact history WhatsApp sends over the wire.
  ev.on(
    "messaging-history.set",
    async ({ chats, contacts, messages, isLatest, syncType }) => {
      try {
        logger.info(
          {
            chats: chats?.length || 0,
            contacts: contacts?.length || 0,
            messages: messages?.length || 0,
            isLatest,
            syncType,
          },
          "messaging-history.set received",
        );
        if (chats?.length) ev.emit("chats.upsert", chats);
        if (contacts?.length) ev.emit("contacts.upsert", contacts);
        if (messages?.length)
          ev.emit("messages.upsert", { messages, type: "append" });
      } catch (err) {
        logger.error({ err }, "messaging-history.set persist failed");
      }
    },
  );

  // ---- Blocklist ----
  ev.on("blocklist.set", ({ blocklist }) => {
    logger.info({ count: blocklist.length }, "blocklist.set received");
  });
  ev.on("blocklist.update", ({ blocklist, type }) => {
    logger.info({ blocklist, type }, "blocklist.update received");
  });
}

module.exports = {
  bindStore,
  getCachedGroupMetadataFactory,
  setGroupCache,
  groupCache,
};
