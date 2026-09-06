const { supabase, unwrap } = require('../config/supabase');

/** Returns the raw (still-serialized) `creds` JSON blob for a session, or null. */
async function get(sessionId) {
  const result = await supabase
    .from('auth_creds')
    .select('creds')
    .eq('session_id', sessionId)
    .maybeSingle();
  const row = unwrap(result, 'auth_creds.get');
  return row ? row.creds : null;
}

async function upsert(sessionId, credsJson) {
  const result = await supabase
    .from('auth_creds')
    .upsert({ session_id: sessionId, creds: credsJson }, { onConflict: 'session_id' });
  unwrap(result, 'auth_creds.upsert');
}

async function remove(sessionId) {
  const result = await supabase.from('auth_creds').delete().eq('session_id', sessionId);
  unwrap(result, 'auth_creds.remove');
}

module.exports = { get, upsert, remove };
