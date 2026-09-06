-- ============================================================================
-- Supabase (PostgreSQL) schema for the Baileys WhatsApp backend.
--
-- Replaces the previous MongoDB/Mongoose models 1:1:
--   AuthCreds.model.js      -> auth_creds
--   AuthKey.model.js        -> auth_keys
--   Session.model.js        -> sessions
--   Chat.model.js            -> chats
--   Contact.model.js         -> contacts
--   GroupMetadata.model.js   -> group_metadata
--   Message.model.js         -> messages
--
-- Run this once against your Supabase project (SQL editor, or `supabase db
-- push` / psql with the connection string). Safe to re-run: everything is
-- guarded with IF NOT EXISTS / OR REPLACE.
-- ============================================================================

create extension if not exists "pgcrypto";

-- Generic trigger to keep `updated_at` current on every UPDATE, mirroring
-- Mongoose's `timestamps: true`.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ----------------------------------------------------------------------------
-- sessions  (Session.model.js)
-- ----------------------------------------------------------------------------
create table if not exists sessions (
  id                      bigserial primary key,
  session_id              text not null unique,
  status                  text not null default 'pending'
                            check (status in ('pending','qr','connecting','open','close','logged_out')),
  qr                      text,
  me_id                   text,
  me_name                 text,
  last_disconnect_reason  text,
  last_connected_at       timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists trg_sessions_updated_at on sessions;
create trigger trg_sessions_updated_at
  before update on sessions
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- auth_creds  (AuthCreds.model.js) — one row per session, holds the `creds` blob
-- ----------------------------------------------------------------------------
create table if not exists auth_creds (
  id          bigserial primary key,
  session_id  text not null unique,
  creds       jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_auth_creds_updated_at on auth_creds;
create trigger trg_auth_creds_updated_at
  before update on auth_creds
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- auth_keys  (AuthKey.model.js) — individual Signal protocol key entries
-- ----------------------------------------------------------------------------
create table if not exists auth_keys (
  id          bigserial primary key,
  session_id  text not null,
  type        text not null,
  key_id      text not null,
  value       jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, type, key_id)
);

create index if not exists idx_auth_keys_session on auth_keys (session_id);

drop trigger if exists trg_auth_keys_updated_at on auth_keys;
create trigger trg_auth_keys_updated_at
  before update on auth_keys
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- chats  (Chat.model.js)
-- ----------------------------------------------------------------------------
create table if not exists chats (
  id                       bigserial primary key,
  session_id               text not null,
  jid                      text not null,
  name                     text default '',
  unread_count             integer default 0,
  conversation_timestamp   bigint default 0,
  pinned                   integer default 0,
  archived                 boolean default false,
  mute_end_time            bigint default 0,
  is_group                 boolean default false,
  last_message_id          text,
  raw                      jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (session_id, jid)
);

create index if not exists idx_chats_session on chats (session_id);
create index if not exists idx_chats_session_conv_ts on chats (session_id, conversation_timestamp desc);

drop trigger if exists trg_chats_updated_at on chats;
create trigger trg_chats_updated_at
  before update on chats
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- contacts  (Contact.model.js)
-- ----------------------------------------------------------------------------
create table if not exists contacts (
  id             bigserial primary key,
  session_id     text not null,
  jid            text not null,
  name           text default '',
  notify         text default '',
  verified_name  text default '',
  img_url        text,
  status         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (session_id, jid)
);

create index if not exists idx_contacts_session on contacts (session_id);

drop trigger if exists trg_contacts_updated_at on contacts;
create trigger trg_contacts_updated_at
  before update on contacts
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- group_metadata  (GroupMetadata.model.js)
-- ----------------------------------------------------------------------------
create table if not exists group_metadata (
  id                  bigserial primary key,
  session_id          text not null,
  jid                 text not null,
  subject             text default '',
  owner               text,
  description         text default '',
  participants        jsonb default '[]'::jsonb,   -- [{ id, admin }]
  announce            boolean default false,
  restrict            boolean default false,
  ephemeral_duration  integer default 0,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (session_id, jid)
);

create index if not exists idx_group_metadata_session on group_metadata (session_id);

drop trigger if exists trg_group_metadata_updated_at on group_metadata;
create trigger trg_group_metadata_updated_at
  before update on group_metadata
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- messages  (Message.model.js)
-- ----------------------------------------------------------------------------
create table if not exists messages (
  id                  bigserial primary key,
  session_id          text not null,
  jid                 text not null,
  message_id          text not null,
  from_me             boolean default false,
  participant         text,
  message_timestamp   bigint default 0,
  status              text not null default 'sent'
                        check (status in ('pending','sent','delivered','read','played','failed','revoked')),
  message_type        text default 'unknown',
  media_path          text,
  media_mimetype      text,
  quoted_message_id   text,
  content             jsonb,        -- raw proto.IWebMessageInfo (JSON-safe)
  deleted             boolean default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (session_id, jid, message_id)
);

create index if not exists idx_messages_session_jid on messages (session_id, jid);
create index if not exists idx_messages_session_jid_ts on messages (session_id, jid, message_timestamp desc);

drop trigger if exists trg_messages_updated_at on messages;
create trigger trg_messages_updated_at
  before update on messages
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- This backend talks to Supabase using the SERVICE ROLE key (server-side
-- only, never exposed to a browser/client), which bypasses RLS entirely. RLS
-- is enabled anyway with no permissive policies, so these tables stay
-- inaccessible if the anon/public key is ever used against them by mistake.
-- ----------------------------------------------------------------------------
alter table sessions        enable row level security;
alter table auth_creds       enable row level security;
alter table auth_keys        enable row level security;
alter table chats            enable row level security;
alter table contacts         enable row level security;
alter table group_metadata   enable row level security;
alter table messages         enable row level security;
