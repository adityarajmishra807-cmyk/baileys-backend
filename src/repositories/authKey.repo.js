const { supabase, unwrap } = require('../config/supabase');

const MAX_DB_RETRIES = 3;
const RETRY_BASE_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_DB_RETRIES; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt === MAX_DB_RETRIES) break;
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError || new Error(`${label} failed`);
}

async function getMany(sessionId, type, keyIds) {
  if (!keyIds?.length) return {};
  return withRetry(async () => {
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
  }, 'auth_keys.getMany');
}

async function getAllByType(sessionId, type) {
  return withRetry(async () => {
    const result = await supabase
      .from('auth_keys')
      .select('key_id, value')
      .eq('session_id', sessionId)
      .eq('type', type);
    return unwrap(result, 'auth_keys.getAllByType');
  }, 'auth_keys.getAllByType');
}

async function applyBatch(sessionId, entries) {
  if (!entries?.length) return;

  await withRetry(async () => {
    const toUpsert = entries
      .filter((e) => e.value !== null && e.value !== undefined)
      .map((e) => ({
        session_id: sessionId,
        type: e.type,
        key_id: e.keyId,
        value: e.value,
      }));

    const toDelete = entries.filter((e) => e.value === null || e.value === undefined);

    if (toUpsert.length) {
      const result = await supabase
        .from('auth_keys')
        .upsert(toUpsert, { onConflict: 'session_id,type,key_id' });
      unwrap(result, 'auth_keys.applyBatch upsert');
    }

    // Deletions are part of the auth-state contract too. Previously these
    // requests were fired without checking their Supabase errors, which could
    // leave stale Signal/app-state keys behind after Baileys asked to delete
    // them. That can cause MessageCounterError and LT-hash/app-state failures.
    if (toDelete.length) {
      const results = await Promise.all(
        toDelete.map((entry) =>
          supabase
            .from('auth_keys')
            .delete()
            .eq('session_id', sessionId)
            .eq('type', entry.type)
            .eq('key_id', entry.keyId),
        ),
      );
      for (const result of results) unwrap(result, 'auth_keys.applyBatch delete');
    }
  }, 'auth_keys.applyBatch');
}

async function clearAll(sessionId) {
  await withRetry(async () => {
    const result = await supabase.from('auth_keys').delete().eq('session_id', sessionId);
    unwrap(result, 'auth_keys.clearAll');
  }, 'auth_keys.clearAll');
}

module.exports = { getMany, getAllByType, applyBatch, clearAll };
