const { supabase, unwrap } = require('../config/supabase');

function normalizeJid(jid) {
  if (typeof jid !== 'string' || !jid) return null;
  const at = jid.indexOf('@');
  if (at < 1) return jid;
  const user = jid.slice(0, at).split(':')[0];
  return `${user}${jid.slice(at)}`;
}

function userToJid(user, domain) {
  if (typeof user !== 'string' || !user) return null;
  if (user.includes('@')) return normalizeJid(user);
  return `${user.split(':')[0]}@${domain}`;
}

function isLidJid(jid) {
  return typeof jid === 'string' && (jid.endsWith('@lid') || jid.endsWith('@hosted.lid'));
}

function isPhoneJid(jid) {
  return typeof jid === 'string' && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us') || jid.endsWith('@hosted'));
}

function toMappingRow(sessionId, lid, pn) {
  const lidJid = normalizeJid(lid);
  const phoneJid = normalizeJid(pn);
  if (!isLidJid(lidJid) || !isPhoneJid(phoneJid)) return null;
  return { session_id: sessionId, lid_jid: lidJid, phone_jid: phoneJid };
}

async function upsertMany(sessionId, mappings) {
  const rows = (mappings || [])
    .map((m) => toMappingRow(sessionId, m?.lid, m?.pn || m?.phoneJid || m?.phoneNumberJid))
    .filter(Boolean);
  if (!rows.length) return;

  for (const row of rows) {
    const result = await supabase
      .from('lid_mappings')
      .upsert(row, { onConflict: 'session_id,lid_jid' });
    unwrap(result, 'lid_mappings.upsertMany');
  }
}

async function upsertBaileysKeyEntries(sessionId, entries) {
  const mappings = [];
  for (const entry of entries || []) {
    if (entry?.type !== 'lid-mapping' || typeof entry.keyId !== 'string' || typeof entry.value !== 'string') continue;

    // Baileys persists two entries for every mapping:
    //   <pnUser>          -> <lidUser>
    //   <lidUser>_reverse -> <pnUser>
    if (entry.keyId.endsWith('_reverse')) {
      mappings.push({
        lid: userToJid(entry.keyId.slice(0, -'_reverse'.length), 'lid'),
        pn: userToJid(entry.value, 's.whatsapp.net'),
      });
    } else {
      mappings.push({
        lid: userToJid(entry.value, 'lid'),
        pn: userToJid(entry.keyId, 's.whatsapp.net'),
      });
    }
  }
  return upsertMany(sessionId, mappings);
}

async function findByLid(sessionId, lid) {
  const normalized = normalizeJid(lid);
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
  const normalized = normalizeJid(phoneJid);
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
  const normalized = [...new Set((lids || []).map(normalizeJid).filter(isLidJid))];
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
  normalizeJid,
  isLidJid,
  isPhoneJid,
  upsertMany,
  upsertBaileysKeyEntries,
  findByLid,
  findByPhone,
  findManyByLids,
  deleteAllForSession,
};
