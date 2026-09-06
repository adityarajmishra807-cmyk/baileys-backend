const { supabase, unwrap } = require('../config/supabase');

function toCamel(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    jid: row.jid,
    messageId: row.message_id,
    fromMe: row.from_me,
    participant: row.participant,
    messageTimestamp: Number(row.message_timestamp),
    status: row.status,
    messageType: row.message_type,
    mediaPath: row.media_path,
    mediaMimetype: row.media_mimetype,
    quotedMessageId: row.quoted_message_id,
    content: row.content,
    deleted: row.deleted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Full upsert (messages.upsert). Each entry is a pre-shaped row (see store.js). */
async function upsertMany(sessionId, entries) {
  if (!entries.length) return;
  const rows = entries.map((e) => ({
    session_id: sessionId,
    jid: e.jid,
    message_id: e.messageId,
    from_me: e.fromMe,
    participant: e.participant,
    message_timestamp: e.messageTimestamp,
    message_type: e.messageType,
    media_path: e.mediaPath,
    media_mimetype: e.mediaMimetype,
    quoted_message_id: e.quotedMessageId,
    content: e.content,
    status: e.status,
  }));
  const result = await supabase.from('messages').upsert(rows, { onConflict: 'session_id,jid,message_id' });
  unwrap(result, 'messages.upsertMany');
}

async function findOne(sessionId, jid, messageId) {
  const result = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('jid', jid)
    .eq('message_id', messageId)
    .maybeSingle();
  return toCamel(unwrap(result, 'messages.findOne'));
}

async function findMany(sessionId, jid, messageIds) {
  if (!messageIds?.length) return [];
  const result = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('jid', jid)
    .in('message_id', messageIds);
  return unwrap(result, 'messages.findMany').map(toCamel);
}

/** Most recent message in a chat (used to build Baileys' `lastMessages` for chatModify). */
async function findLatest(sessionId, jid) {
  const result = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('jid', jid)
    .order('message_timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  return toCamel(unwrap(result, 'messages.findLatest'));
}

async function findAllForChat(sessionId, jid) {
  const result = await supabase.from('messages').select('*').eq('session_id', sessionId).eq('jid', jid);
  return unwrap(result, 'messages.findAllForChat').map(toCamel);
}

/** Paginated history, newest-first at the DB level then reversed by the caller (matches prior behavior). */
async function findHistory(sessionId, jid, { before, limit = 50 } = {}) {
  let query = supabase
    .from('messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('jid', jid)
    .eq('deleted', false)
    .order('message_timestamp', { ascending: false })
    .limit(Math.min(Number(limit), 200));
  if (before) query = query.lt('message_timestamp', Number(before));
  const result = await query;
  return unwrap(result, 'messages.findHistory').map(toCamel);
}

/** Partial field update for one message (messages.update — status changes, revokes). */
async function updateByKey(sessionId, jid, messageId, patch) {
  const row = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.deleted !== undefined) row.deleted = patch.deleted;
  if (!Object.keys(row).length) return;
  const result = await supabase
    .from('messages')
    .update(row)
    .eq('session_id', sessionId)
    .eq('jid', jid)
    .eq('message_id', messageId);
  unwrap(result, 'messages.updateByKey');
}

async function markDeletedForChat(sessionId, jid) {
  const result = await supabase
    .from('messages')
    .update({ deleted: true })
    .eq('session_id', sessionId)
    .eq('jid', jid);
  unwrap(result, 'messages.markDeletedForChat');
}

async function markDeletedByIds(sessionId, messageIds) {
  if (!messageIds?.length) return;
  const result = await supabase
    .from('messages')
    .update({ deleted: true })
    .eq('session_id', sessionId)
    .in('message_id', messageIds);
  unwrap(result, 'messages.markDeletedByIds');
}

async function deleteAllForSession(sessionId) {
  const result = await supabase.from('messages').delete().eq('session_id', sessionId);
  unwrap(result, 'messages.deleteAllForSession');
}

async function deleteAllForChat(sessionId, jid) {
  const result = await supabase.from('messages').delete().eq('session_id', sessionId).eq('jid', jid);
  unwrap(result, 'messages.deleteAllForChat');
}

module.exports = {
  upsertMany,
  findOne,
  findMany,
  findLatest,
  findAllForChat,
  findHistory,
  updateByKey,
  markDeletedForChat,
  markDeletedByIds,
  deleteAllForSession,
  deleteAllForChat,
};
