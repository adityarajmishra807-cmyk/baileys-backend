-- WhatsApp/Baileys timestamps are commonly Unix timestamps in milliseconds.
-- Existing deployments may have older INTEGER columns, which overflow at values
-- such as 1738073805122. BIGINT is required for these values.

alter table if exists chats
  alter column conversation_timestamp type bigint
  using conversation_timestamp::bigint;

alter table if exists chats
  alter column mute_end_time type bigint
  using mute_end_time::bigint;

alter table if exists messages
  alter column message_timestamp type bigint
  using message_timestamp::bigint;

alter table if exists group_metadata
  alter column ephemeral_duration type bigint
  using ephemeral_duration::bigint;

create index if not exists idx_chats_session_conv_ts
  on chats (session_id, conversation_timestamp desc);

create index if not exists idx_messages_session_jid_ts
  on messages (session_id, jid, message_timestamp desc);
