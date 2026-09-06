const { supabase, unwrap } = require('../config/supabase');

function toCamel(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    jid: row.jid,
    subject: row.subject,
    owner: row.owner,
    desc: row.description,
    participants: row.participants || [],
    announce: row.announce,
    restrict: row.restrict,
    ephemeralDuration: row.ephemeral_duration,
    raw: row.raw,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Full upsert (groups.upsert) — one group at a time, mirroring the original per-group loop. */
async function upsertOne(sessionId, g) {
  const row = {
    session_id: sessionId,
    jid: g.id,
    subject: g.subject,
    owner: g.owner || null,
    description: g.desc || '',
    participants: JSON.parse(JSON.stringify(g.participants || [])),
    announce: !!g.announce,
    restrict: !!g.restrict,
    ephemeral_duration: g.ephemeralDuration || 0,
    raw: JSON.parse(JSON.stringify(g)),
  };
  const result = await supabase.from('group_metadata').upsert(row, { onConflict: 'session_id,jid' });
  unwrap(result, 'group_metadata.upsertOne');
}

/** Partial upsert (groups.update) — patches whatever fields Baileys sent for this update. */
async function upsertPartial(sessionId, jid, patch) {
  const row = {};
  if (patch.subject !== undefined) row.subject = patch.subject;
  if (patch.owner !== undefined) row.owner = patch.owner;
  if (patch.desc !== undefined) row.description = patch.desc;
  if (patch.announce !== undefined) row.announce = patch.announce;
  if (patch.restrict !== undefined) row.restrict = patch.restrict;
  if (patch.ephemeralDuration !== undefined) row.ephemeral_duration = patch.ephemeralDuration;
  row.raw = JSON.parse(JSON.stringify(patch));

  const result = await supabase
    .from('group_metadata')
    .upsert({ session_id: sessionId, jid, ...row }, { onConflict: 'session_id,jid' });
  unwrap(result, 'group_metadata.upsertPartial');
}

async function findAll(sessionId) {
  const result = await supabase.from('group_metadata').select('*').eq('session_id', sessionId);
  return unwrap(result, 'group_metadata.findAll').map(toCamel);
}

async function findOne(sessionId, jid) {
  const result = await supabase
    .from('group_metadata')
    .select('*')
    .eq('session_id', sessionId)
    .eq('jid', jid)
    .maybeSingle();
  return toCamel(unwrap(result, 'group_metadata.findOne'));
}

async function updateParticipants(sessionId, jid, participants) {
  const result = await supabase
    .from('group_metadata')
    .update({ participants: JSON.parse(JSON.stringify(participants)) })
    .eq('session_id', sessionId)
    .eq('jid', jid);
  unwrap(result, 'group_metadata.updateParticipants');
}

async function deleteOne(sessionId, jid) {
  const result = await supabase.from('group_metadata').delete().eq('session_id', sessionId).eq('jid', jid);
  unwrap(result, 'group_metadata.deleteOne');
}

async function deleteAllForSession(sessionId) {
  const result = await supabase.from('group_metadata').delete().eq('session_id', sessionId);
  unwrap(result, 'group_metadata.deleteAllForSession');
}

module.exports = { upsertOne, upsertPartial, findAll, findOne, updateParticipants, deleteOne, deleteAllForSession };
