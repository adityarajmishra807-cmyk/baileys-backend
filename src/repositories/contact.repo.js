const { supabase, unwrap } = require('../config/supabase');

function toCamel(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    jid: row.jid,
    name: row.name,
    notify: row.notify,
    verifiedName: row.verified_name,
    imgUrl: row.img_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Full upsert (contacts.upsert). */
async function upsertMany(sessionId, contacts) {
  if (!contacts.length) return;
  const rows = contacts.map((c) => ({
    session_id: sessionId,
    jid: c.id,
    name: c.name || '',
    notify: c.notify || '',
    verified_name: c.verifiedName || '',
    img_url: c.imgUrl || null,
    status: c.status || null,
  }));
  const result = await supabase.from('contacts').upsert(rows, { onConflict: 'session_id,jid' });
  unwrap(result, 'contacts.upsertMany');
}

/** Partial upsert (contacts.update) — only the fields present on each update, upserting the row. */
async function upsertPartialMany(sessionId, updates) {
  for (const u of updates.filter((x) => x.id)) {
    const patch = {};
    if (u.name !== undefined) patch.name = u.name;
    if (u.notify !== undefined) patch.notify = u.notify;
    if (u.imgUrl !== undefined) patch.img_url = u.imgUrl;
    if (u.status !== undefined) patch.status = u.status;
    if (!Object.keys(patch).length) continue;

    const { data: updated } = await supabase
      .from('contacts')
      .update(patch)
      .eq('session_id', sessionId)
      .eq('jid', u.id)
      .select('id');

    if (!updated?.length) {
      const result = await supabase
        .from('contacts')
        .upsert({ session_id: sessionId, jid: u.id, ...patch }, { onConflict: 'session_id,jid' });
      unwrap(result, 'contacts.upsertPartialMany insert-branch');
    }
  }
}

async function findAll(sessionId) {
  const result = await supabase.from('contacts').select('*').eq('session_id', sessionId);
  return unwrap(result, 'contacts.findAll').map(toCamel);
}

async function deleteAllForSession(sessionId) {
  const result = await supabase.from('contacts').delete().eq('session_id', sessionId);
  unwrap(result, 'contacts.deleteAllForSession');
}

module.exports = { upsertMany, upsertPartialMany, findAll, deleteAllForSession };
