const { supabase, unwrap } = require('../config/supabase');

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError || new Error(`${label} failed`);
}

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
  const unique = new Map();
  for (const m of mappings || []) {
    const row = toMappingRow(sessionId, m?.lid, m?.pn || m?.phoneJid || m?.phoneNumberJid);
    if (row) unique.set(`${row.lid_jid}:${row.phone_jid}`, row);
  }
  const rows = [...unique.values()];
  if (!rows.length) return;

  // One batched request is important during initial history sync. The previous
  // implementation issued one HTTP request per mapping, making a large sync
  // extremely slow and allowing transient Supabase failures to interrupt it.
  return withRetry(async () => {
    const result = await supabase
      .from('lid_mappings')
      .upsert(rows, { onConflict: 'session_id,lid_jid' });
    unwrap(result, 'lid_mappings.upsertMany');
  }, 'lid_mappings.upsertMany');
}

async function upsertBaileysKeyEntries(sessionId, entries) {
  const mappings = [];
  for (const entry of entries || []) {
    if (entry?.type !== 'lid-mapping' || typeof entry.keyId !== 'string' || typeof entry.value !== 'string') continue;

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
