const { supabase, unwrap } = require('../config/supabase');

async function getMany(sessionId, type, keyIds) {
  if (!keyIds?.length) return {};
  const result = await supabase
    .from('auth_keys')
    .select('key_id, value')
    .eq('session_id', sessionId)
    .eq('type', type)
    .in('key_id', keyIds);
  const rows = unwrap(result, 'auth_keys.getMany');
  const out = {};
  for (const row of rows) out[row.key_id] = row.value;
  return out;
}

async function getAllByType(sessionId, type) {
  const result = await supabase
    .from('auth_keys')
    .select('key_id, value')
    .eq('session_id', sessionId)
    .eq('type', type);
  return unwrap(result, 'auth_keys.getAllByType');
}

async function applyBatch(sessionId, entries) {
  const toUpsert = entries
    .filter((e) => e.value !== null && e.value !== undefined)
    .map((e) => ({ session_id: sessionId, type: e.type, key_id: e.keyId, value: e.value }));
  const toDelete = entries.filter((e) => e.value === null || e.value === undefined);

  if (toUpsert.length) {
    const result = await supabase
      .from('auth_keys')
      .upsert(toUpsert, { onConflict: 'session_id,type,key_id' });
    unwrap(result, 'auth_keys.applyBatch upsert');
  }

  if (toDelete.length) {
    await Promise.all(
      toDelete.map((e) =>
        supabase
          .from('auth_keys')
          .delete()
          .eq('session_id', sessionId)
          .eq('type', e.type)
          .eq('key_id', e.keyId)
      )
    );
  }
}

async function clearAll(sessionId) {
  const result = await supabase.from('auth_keys').delete().eq('session_id', sessionId);
  unwrap(result, 'auth_keys.clearAll');
}

module.exports = { getMany, getAllByType, applyBatch, clearAll };
