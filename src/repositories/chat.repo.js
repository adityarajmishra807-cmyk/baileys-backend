const { supabase, unwrap } = require('../config/supabase');

function toCamel(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    jid: row.jid,
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

/** Full upsert (chats.upsert) — replaces name/counts/flags/raw wholesale. */
async function upsertMany(sessionId, chats) {
  if (!chats.length) return;
  const rows = chats.map((c) => ({
    session_id: sessionId,
    jid: c.id,
    name: c.name || '',
    unread_count: c.unreadCount || 0,
    conversation_timestamp: Number(c.conversationTimestamp || 0),
    pinned: c.pinned || 0,
    archived: !!c.archived,
    mute_end_time: Number(c.muteEndTime || 0),
    is_group: !!c.id?.endsWith('@g.us'),
    raw: JSON.parse(JSON.stringify(c)),
  }));
  const result = await supabase.from('chats').upsert(rows, { onConflict: 'session_id,jid' });
  unwrap(result, 'chats.upsertMany');
}

/**
 * Partial upsert (chats.update) — only overwrites the fields present on each
 * update object, creating the row if it doesn't exist yet (mirrors Mongoose's
 * `$set` + `upsert: true` on a subset of fields).
 */
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
      .from('chats')
      .update(patch)
      .eq('session_id', sessionId)
      .eq('jid', u.id)
      .select('id');

    if (!updated?.length) {
      const result = await supabase
        .from('chats')
        .upsert({ session_id: sessionId, jid: u.id, ...patch }, { onConflict: 'session_id,jid' });
      unwrap(result, 'chats.upsertPartialMany insert-branch');
    }
  }
}

/** Bumps last_message_id/conversation_timestamp, creating the chat row (is_group default) if missing. */
async function touchLastMessage(sessionId, jid, { lastMessageId, conversationTimestamp }) {
  const { data: updated } = await supabase
    .from('chats')
    .update({ last_message_id: lastMessageId, conversation_timestamp: conversationTimestamp })
    .eq('session_id', sessionId)
    .eq('jid', jid)
    .select('id');

  if (!updated?.length) {
    const result = await supabase.from('chats').upsert(
      {
        session_id: sessionId,
        jid,
        last_message_id: lastMessageId,
        conversation_timestamp: conversationTimestamp,
        is_group: jid.endsWith('@g.us'),
      },
      { onConflict: 'session_id,jid' }
    );
    unwrap(result, 'chats.touchLastMessage insert-branch');
  }
}

async function findAll(sessionId) {
  const result = await supabase
    .from('chats')
    .select('*')
    .eq('session_id', sessionId)
    .order('conversation_timestamp', { ascending: false });
  return unwrap(result, 'chats.findAll').map(toCamel);
}

async function findOne(sessionId, jid) {
  const result = await supabase.from('chats').select('*').eq('session_id', sessionId).eq('jid', jid).maybeSingle();
  return toCamel(unwrap(result, 'chats.findOne'));
}

async function deleteOne(sessionId, jid) {
  const result = await supabase.from('chats').delete().eq('session_id', sessionId).eq('jid', jid);
  unwrap(result, 'chats.deleteOne');
}

async function deleteMany(sessionId, jids) {
  if (!jids?.length) return;
  const result = await supabase.from('chats').delete().eq('session_id', sessionId).in('jid', jids);
  unwrap(result, 'chats.deleteMany');
}

async function deleteAllForSession(sessionId) {
  const result = await supabase.from('chats').delete().eq('session_id', sessionId);
  unwrap(result, 'chats.deleteAllForSession');
}

module.exports = {
  upsertMany,
  upsertPartialMany,
  touchLastMessage,
  findAll,
  findOne,
  deleteOne,
  deleteMany,
  deleteAllForSession,
};
