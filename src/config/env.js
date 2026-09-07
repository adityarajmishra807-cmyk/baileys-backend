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
  SOCKET_TOKEN_SECRET: process.env.SOCKET_TOKEN_SECRET || process.env.API_KEY || '',

  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',

  REDIS_ENABLED: bool(process.env.REDIS_ENABLED, false),
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',

  MEDIA_STORAGE_PATH: process.env.MEDIA_STORAGE_PATH || './storage/media',
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB || '64', 10),

  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  // Pull the complete WhatsApp inbox history unless explicitly disabled.
  // This prevents a fresh/reconnected session from only restoring recent chats.
  SYNC_FULL_HISTORY: bool(process.env.SYNC_FULL_HISTORY, true),
  MARK_ONLINE_ON_CONNECT: bool(process.env.MARK_ONLINE_ON_CONNECT, false),
};

if (env.NODE_ENV === 'production' && !env.API_KEY) {
  console.error('FATAL: API_KEY must be set in production. Refusing to start with an open API.');
  process.exit(1);
}

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

module.exports = env;
