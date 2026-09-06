const { createClient } = require('@supabase/supabase-js');
const env = require('./env');
const { rootLogger } = require('./logger');

// Server-side client using the SERVICE ROLE key — bypasses Row Level
// Security, so this must only ever run on the backend, never be shipped to
// a browser/mobile client.
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
});

/**
 * There's no persistent "connection" to open with Supabase's REST-based
 * client (unlike Mongoose), but we do a cheap round-trip on boot so startup
 * fails fast and loudly if the URL/key are wrong or the schema hasn't been
 * applied yet, instead of surfacing as a confusing error on first request.
 */
async function connectDB() {
  const { error } = await supabase.from('sessions').select('id', { head: true, count: 'exact' }).limit(1);
  if (error) {
    rootLogger.error({ err: error }, 'Supabase connectivity check failed');
    throw new Error(
      `Could not reach Supabase ("${error.message}"). Check SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY and that supabase/schema.sql has been applied.`
    );
  }
  rootLogger.info('Supabase connected');
}

/** Throws a readable error if a Supabase call failed, otherwise returns `data`. */
function unwrap(result, context) {
  if (result.error) {
    const err = new Error(`${context}: ${result.error.message}`);
    err.cause = result.error;
    throw err;
  }
  return result.data;
}

module.exports = { supabase, connectDB, unwrap };
