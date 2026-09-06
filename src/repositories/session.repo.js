const { supabase, unwrap } = require('../config/supabase');

function toCamel(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    status: row.status,
    qr: row.qr,
    me: row.me_id || row.me_name ? { id: row.me_id, name: row.me_name } : null,
    lastDisconnectReason: row.last_disconnect_reason,
    lastConnectedAt: row.last_connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Upserts a session row, patching only the fields provided in `patch`. */
async function upsert(sessionId, patch = {}) {
  const row = { session_id: sessionId };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.qr !== undefined) row.qr = patch.qr;
  if (patch.me !== undefined) {
    row.me_id = patch.me?.id ?? null;
    row.me_name = patch.me?.name ?? null;
  }
  if (patch.lastDisconnectReason !== undefined) row.last_disconnect_reason = patch.lastDisconnectReason;
  if (patch.lastConnectedAt !== undefined) row.last_connected_at = patch.lastConnectedAt;

  const result = await supabase.from('sessions').upsert(row, { onConflict: 'session_id' });
  unwrap(result, 'sessions.upsert');
}

async function findBySessionId(sessionId) {
  const result = await supabase.from('sessions').select('*').eq('session_id', sessionId).maybeSingle();
  return toCamel(unwrap(result, 'sessions.findBySessionId'));
}

/** All sessions (used by GET /sessions — trimmed to the fields the list view needs). */
async function findAll() {
  const result = await supabase
    .from('sessions')
    .select('session_id, status, me_id, me_name, last_connected_at');
  return unwrap(result, 'sessions.findAll').map(toCamel);
}

/** sessionIds not explicitly logged out — used to resume sessions on server boot. */
async function findActiveSessionIds() {
  const result = await supabase.from('sessions').select('session_id').neq('status', 'logged_out');
  return unwrap(result, 'sessions.findActiveSessionIds').map((r) => r.session_id);
}

async function deleteBySessionId(sessionId) {
  const result = await supabase.from('sessions').delete().eq('session_id', sessionId);
  unwrap(result, 'sessions.deleteBySessionId');
}

module.exports = { upsert, findBySessionId, findAll, findActiveSessionIds, deleteBySessionId };
