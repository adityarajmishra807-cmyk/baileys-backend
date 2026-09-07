const { supabase, unwrap } = require("../config/supabase");

function extractPhoneNumber(row) {
  const raw = row?.raw;
  if (!raw || typeof raw !== 'object') return null;
  const candidates = [raw.pnJid, raw.phoneNumber, raw.phoneNumberJid, raw?.contact?.pnJid, raw?.contact?.phoneNumber];
  for (const value of candidates) {
    if (typeof value !== 'string' || !value) continue;
    if (value.endsWith('@s.whatsapp.net') || value.endsWith('@c.us') || value.endsWith('@hosted')) return value.split('@')[0].split(':')[0];
    if (/^\d{6,20}$/.test(value)) return value;
  }
  return null;
}

function toCamel(row, mapping = null) {
  if (!row) return null;
  const isLid = row.jid?.endsWith('@lid') || row.jid?.endsWith('@hosted.lid');
  const phoneJid = isLid ? mapping?.phone_jid || null : row.jid;
  const phoneNumber = phoneJid
    ? phoneJid.split('@')[0].split(':')[0]
    : extractPhoneNumber(row);

  return {
    sessionId: row.session_id,
    jid: row.jid,
    phoneJid,
    phoneNumber,
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

async function upsertMany(sessionId, chats) {
  if (!chats.length) return;
  const rows = chats.map((c) => ({
    session_id: sessionId,
    jid: c.id,
    name: c.name || "",
    unread_count: c.unreadCount || 0,
    conversation_timestamp: Number(c.conversationTimestamp || 0),
    pinned: c.pinned || 0,
    archived: !!c.archived,
    mute_end_time: Number(c.muteEndTime || 0),
    is_group: !!c.id?.endsWith("@g.us"),
    raw: JSON.parse(JSON.stringify(c)),
  }));
  const result = await supabase
    .from("chats")
    .upsert(rows, { onConflict: "session_id,jid" });
  unwrap(result, "chats.upsertMany");
}

async function upsertPartialMany(sessionId, updates) {
  for (const u of updates) {
    const patch = {};
    if (u.name !== undefined) patch.name = u.name;
    if (u.unreadCount !== undefined) patch.unread_count = u.unreadCount;
    if (u.conversationTimestamp !== undefined) patch.conversation_timestamp = Number(u.conversationTimestamp);
    if (u.pinned !== undefined) patch.pinned = u.pinned;
    if (u.archived !== undefined) patch.archived = u.archived;
    if (u.muteEndTime !== undefined) patch.mute_end_time = Number(u.muteEndTime);
    if (!Object.keys(patch).length) continue;

    const { data: updated } = await supabase
      .from("chats")
      .update(patch)
      .eq("session_id", sessionId)
      .eq("jid", u.id)
      .select("id");

    if (!updated?.length) {
      const result = await supabase
        .from("chats")
        .upsert({ session_id: sessionId, jid: u.id, ...patch }, { onConflict: "session_id,jid" });
      unwrap(result, "chats.upsertPartialMany insert-branch");
    }
  }
}

async function touchLastMessage(sessionId, jid, { lastMessageId, conversationTimestamp }) {
  const { data: updated } = await supabase
    .from("chats")
    .update({ last_message_id: lastMessageId, conversation_timestamp: conversationTimestamp })
    .eq("session_id", sessionId)
    .eq("jid", jid)
    .select("id");

  if (!updated?.length) {
    const result = await supabase.from("chats").upsert(
      {
        session_id: sessionId,
        jid,
        last_message_id: lastMessageId,
        conversation_timestamp: conversationTimestamp,
        is_group: jid.endsWith("@g.us"),
      },
      { onConflict: "session_id,jid" },
    );
    unwrap(result, "chats.touchLastMessage insert-branch");
  }
}

function baseChatQuery(sessionId) {
  return supabase
    .from("chats")
    .select("*")
    .eq("session_id", sessionId)
    .not("jid", "like", "%@broadcast")
    .not("jid", "like", "%@newsletter")
    .order("conversation_timestamp", { ascending: false });
}

async function findAll(sessionId) {
  const result = await baseChatQuery(sessionId);
  return unwrap(result, "chats.findAll").map((row) => toCamel(row));
}

async function findPage(sessionId, { limit = 50, before } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  let query = baseChatQuery(sessionId).limit(safeLimit + 1);
  if (before) query = query.lt("conversation_timestamp", Number(before));
  const rows = unwrap(await query, "chats.findPage");
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const last = pageRows[pageRows.length - 1];

  return {
    rows: pageRows,
    hasMore,
    nextCursor: hasMore && last ? String(last.conversation_timestamp) : null,
  };
}

async function findOne(sessionId, jid) {
  const result = await supabase
    .from("chats")
    .select("*")
    .eq("session_id", sessionId)
    .eq("jid", jid)
    .maybeSingle();
  return toCamel(unwrap(result, "chats.findOne"));
}

async function deleteOne(sessionId, jid) {
  const result = await supabase.from("chats").delete().eq("session_id", sessionId).eq("jid", jid);
  unwrap(result, "chats.deleteOne");
}

async function deleteMany(sessionId, jids) {
  if (!jids?.length) return;
  const result = await supabase.from("chats").delete().eq("session_id", sessionId).in("jid", jids);
  unwrap(result, "chats.deleteMany");
}

async function deleteAllForSession(sessionId) {
  const result = await supabase.from("chats").delete().eq("session_id", sessionId);
  unwrap(result, "chats.deleteAllForSession");
}

module.exports = { upsertMany, upsertPartialMany, touchLastMessage, findAll, findPage, findOne, deleteOne, deleteMany, deleteAllForSession };
