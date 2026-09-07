-- Persistent WhatsApp LID <-> phone JID mappings.
-- LID values are opaque identifiers; never interpret the numeric part of @lid as a phone number.
create table if not exists lid_mappings (
  id          bigserial primary key,
  session_id  text not null,
  lid_jid     text not null,
  phone_jid   text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (session_id, lid_jid),
  unique (session_id, phone_jid)
);

create index if not exists idx_lid_mappings_session_lid
  on lid_mappings (session_id, lid_jid);
create index if not exists idx_lid_mappings_session_phone
  on lid_mappings (session_id, phone_jid);

drop trigger if exists trg_lid_mappings_updated_at on lid_mappings;
create trigger trg_lid_mappings_updated_at
  before update on lid_mappings
  for each row execute function set_updated_at();

alter table lid_mappings enable row level security;
