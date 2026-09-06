require('dotenv').config();

function bool(val, def = false) {
  if (val === undefined) return def;
  return String(val).toLowerCase() === 'true';
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '8000', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  API_KEY: process.env.API_KEY || '',

  // Supabase (auth state + chats/contacts/messages/groups persistence)
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  // Server-side only — the service role key bypasses RLS, so it must never
  // be exposed to a browser/frontend. Use the anon/public key on the client.
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  REDIS_ENABLED: bool(process.env.REDIS_ENABLED, false),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',

  MEDIA_STORAGE_PATH: process.env.MEDIA_STORAGE_PATH || './storage/media',
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB || '64', 10),

  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  SYNC_FULL_HISTORY: bool(process.env.SYNC_FULL_HISTORY, false),
  MARK_ONLINE_ON_CONNECT: bool(process.env.MARK_ONLINE_ON_CONNECT, false),
};

if (env.NODE_ENV === 'production' && !env.API_KEY) {
  // eslint-disable-next-line no-console
  console.error('FATAL: API_KEY must be set in production. Refusing to start with an open API.');
  process.exit(1);
}

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  // eslint-disable-next-line no-console
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

module.exports = env;
