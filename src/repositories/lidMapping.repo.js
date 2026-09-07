const { supabase, unwrap } = require('../config/supabase');

function normalizeUserJid(jid) {
  if (typeof jid !== 'string' || !jid) return null;
  const at = jid.indexOf('@');
  if (at < 1) return jid;
  const user = jid.slice(0, at).split(':')[0];
  return `${user}${jid.slice(at)}`;
}

function isLidJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

function isPhoneJid(jid) {
  return typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us'));
}

async function upsertMany(sessionId, mappings) {
  const rows = [];
  for (const mapping of mappings || []) {
    const lid = normalizeUserJid(mapping?.lid);
    const phoneJid = normalizeUserJid(mapping?.pn || mapping?.phoneJid || mapping?.phoneNumberJid);
    if (!isLidJid(lid) || !isPhoneJid(phoneJid)) continue;
    rows.push({ session_id: sessionId, lid_jid: lid, phone_jid: phoneJid });
  }
  if (!rows.length) return;

  const result = await supabase
    .from('lid_mappings')
    .upsert(rows, { onConflict: 'session_id,lid_jid' });
  unwrap(result, 'lid_mappings.upsertMany');
}

async function findByLid(sessionId, lid) {
  const normalized = normalizeUserJid(lid);
  if (!isLidJid(normalized)) return null;
  const result = await supabase
    .from('lid_mappings')
    .select('lid_jid, phone_jid')
    .eq('session_id', sessionId)
    .eq('lid_jid', normalized)
    .maybeSingle();
  return unwrap(result, 'lid_mappings.findByLid');
}

async function findByPhone(sessionId, phoneJid) {
  const normalized = normalizeUserJid(phoneJid);
  if (!isPhoneJid(normalized)) return null;
  const result = await supabase
    .from('lid_mappings')
    .select('lid_jid, phone_jid')
    .eq('session_id', sessionId)
    .eq('phone_jid', normalized)
    .maybeSingle();
  return unwrap(result, 'lid_mappings.findByPhone');
}

async function findManyByLids(sessionId, lids) {
  const normalized = [...new Set((lids || []).map(normalizeUserJid).filter(isLidJid))];
  if (!normalized.length) return [];
  const result = await supabase
    .from('lid_mappings')
    .select('lid_jid, phone_jid')
    .eq('session_id', sessionId)
    .in('lid_jid', normalized);
  return unwrap(result, 'lid_mappings.findManyByLids');
}

async function deleteAllForSession(sessionId) {
  const result = await supabase.from('lid_mappings').delete().eq('session_id', sessionId);
  unwrap(result, 'lid_mappings.deleteAllForSession');
}

module.exports = {
  normalizeUserJid,
  isLidJid,
  isPhoneJid,
  upsertMany,
  findByLid,
  findByPhone,
  findManyByLids,
  deleteAllForSession,
};
