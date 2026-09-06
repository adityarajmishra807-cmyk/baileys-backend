# Baileys WhatsApp Backend

Production-ready Express + [Baileys](https://baileys.wiki) backend for multi-account WhatsApp
integration: QR login, persistent sessions (scan once, never re-login), full data store,
media handling, groups, privacy, presence, history sync, and realtime Socket.IO events.

## Architecture

```
src/
  config/        env, pino logger, Supabase client
  repositories/  Data-access layer (Postgres via Supabase): authCreds, authKey, session, chat, contact, message, group
  baileys/
    authState.js     Supabase-backed auth state (replaces useMultiFileAuthState for prod)
    store.js         Persists every Baileys event (chats/contacts/messages/groups/history) to Supabase
    sessionManager.js  Connection lifecycle: connect, QR, reconnect w/ backoff, logout, multi-session registry
    messageSender.js  Builds/sends every message content type
  controllers/   REST handlers per resource
  routes/        Express routers
  middleware/    API-key auth, async wrapper, centralized error handler
  sockets/       Socket.IO server (+ optional Redis adapter for multi-instance)
  utils/         Local-disk media storage
supabase/
  schema.sql     Table definitions, indexes, and RLS setup — run once against your Supabase project
```

**Why Supabase instead of `useMultiFileAuthState`:** the Baileys docs explicitly call file-based
auth state a dev-only convenience and recommend a real datastore for production, since it lets
you survive restarts/redeploys and (with care) run behind a shared filesystem-less container.
`authState.js` implements the same `AuthenticationState` contract Baileys expects, backed by two
Postgres tables (`auth_creds` for the single creds blob, `auth_keys` for individual Signal keys).
The backend talks to Supabase server-side with the **service role key**, which bypasses Row Level
Security — RLS is still enabled on every table as a safety net in case the anon/public key is ever
used against them by mistake.

**Why sessions auto-resume on boot:** `server.js` reconnects every session that isn't explicitly
`logged_out` when the process starts, so a crash/redeploy never forces the user to scan the QR
code again — only calling `POST /sessions/:id/logout` does that.

**Multi-session:** every route is scoped by a `:sessionId` you choose (e.g. one per WhatsApp
number). Each gets its own Baileys socket, auth state, QR flow, and Socket.IO room.

## Setup

1. Create a project at [supabase.com](https://supabase.com) (or point at your own self-hosted
   Supabase stack).
2. Apply the schema — open the SQL editor in the Supabase dashboard, paste in
   `supabase/schema.sql`, and run it (or `psql "$SUPABASE_DB_URL" -f supabase/schema.sql`).
3. Grab your project URL and **service role key** from Project Settings → API.

```bash
npm install
cp .env.example .env   # edit values, especially API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm run dev            # or: npm start
```

Or with Docker (spins up Redis too — Supabase itself is a managed/hosted service, not a container
in this compose file):

```bash
cp .env.example .env
docker compose up --build
```

## Connecting a WhatsApp number

1. `POST /api/sessions/:sessionId/start` — begins the connection.
2. Open a Socket.IO connection, authenticate with `auth: { token: API_KEY }`, then
   `socket.emit('join', sessionId)`.
3. Listen for the `qr` event — it carries a data-URL PNG. Render it and scan with WhatsApp
   (Linked Devices → Link a Device).
4. Listen for `connection.update` — `status: 'open'` means you're logged in. From then on the
   session persists in Supabase and reconnects automatically; the user never scans again unless
   they log out from their phone or you call the logout endpoint.

## REST API

All routes are prefixed with `/api` and require `Authorization: Bearer <API_KEY>` (unless
`API_KEY` is left empty, which is only allowed outside `NODE_ENV=production`).

### Sessions
| Method | Path | Description |
|---|---|---|
| GET | `/sessions` | List all known sessions + status |
| POST | `/sessions/:id/start` | Start/resume a session (triggers QR if not logged in) |
| GET | `/sessions/:id/status` | Current status + QR (if pending) |
| POST | `/sessions/:id/logout` | Logs out on WhatsApp's side, wipes auth so re-scan is required |
| DELETE | `/sessions/:id` | Deletes the session and ALL its data (chats/messages/groups/media) |
| POST | `/sessions/:id/check-numbers` | `{ numbers: string[] }` — checks WhatsApp registration (uses USync under the hood via `onWhatsApp`) |

### Messages
| Method | Path | Description |
|---|---|---|
| GET | `/messages/:id/:jid/history?limit=&before=` | Paginated message history for a chat |
| POST | `/messages/:id/:jid/send` | Send a message — see body shape below |
| POST | `/messages/:id/:jid/read` | `{ messageIds: string[] }` — mark as read |
| PATCH | `/messages/:id/:jid/:messageId` | `{ text }` — edit a previously sent text message |
| DELETE | `/messages/:id/:jid/:messageId` | Delete/revoke for everyone |
| POST | `/messages/:id/:jid/:messageId/react` | `{ emoji }` — react to a message |

**Send body** (`multipart/form-data` if attaching a file via the `file` field, otherwise JSON):
```jsonc
{ "type": "text", "text": "Hello!" }
{ "type": "image", "url": "https://...", "caption": "..." }       // or attach `file`
{ "type": "video", "caption": "...", "gifPlayback": false }
{ "type": "audio", "ptt": true }                                   // voice note
{ "type": "document", "fileName": "invoice.pdf", "mimetype": "application/pdf" }
{ "type": "sticker" }
{ "type": "location", "latitude": 12.9, "longitude": 77.6, "address": "..." }
{ "type": "contact", "displayName": "Jane", "vcard": "BEGIN:VCARD..." }
{ "type": "poll", "pollName": "Lunch?", "pollOptions": ["Pizza","Sushi"], "pollSelectableCount": 1 }
{ "type": "reaction", "emoji": "👍", "reactToKey": { "...": "..." } }
// any type can add: "quotedMessageId": "<id of message in this chat to reply to>"
```

### Chats
| Method | Path | Description |
|---|---|---|
| GET | `/chats/:id` | List chats |
| GET | `/chats/:id/:jid` | Get one chat |
| PATCH | `/chats/:id/:jid` | `{ action: 'archive'|'pin'|'mute'|'markRead'|'markUnread', value }` |
| DELETE | `/chats/:id/:jid` | Delete chat |
| DELETE | `/chats/:id/:jid/messages` | Clear all messages in a chat |

### Groups
| Method | Path | Description |
|---|---|---|
| GET | `/groups/:id` | List known groups |
| POST | `/groups/:id` | `{ subject, participants: string[] }` — create group |
| GET | `/groups/:id/:jid` | Fresh metadata for one group |
| PATCH | `/groups/:id/:jid/subject` | `{ subject }` |
| PATCH | `/groups/:id/:jid/description` | `{ description }` |
| POST | `/groups/:id/:jid/participants` | `{ action: 'add'|'remove'|'promote'|'demote', participants: string[] }` |
| PATCH | `/groups/:id/:jid/setting` | `{ setting: 'announcement'|'not_announcement'|'locked'|'unlocked' }` |
| GET | `/groups/:id/:jid/invite-code` | Get invite link |
| POST | `/groups/:id/:jid/invite-code/revoke` | Revoke + regenerate invite link |
| POST | `/groups/:id/join` | `{ code }` — join via invite link/code |
| POST | `/groups/:id/:jid/leave` | Leave group |
| PATCH | `/groups/:id/:jid/ephemeral` | `{ seconds }` — disappearing messages (0/86400/604800/7776000) |

### Privacy
| Method | Path | Description |
|---|---|---|
| GET | `/privacy/:id` | Fetch current privacy settings |
| PATCH | `/privacy/:id` | `{ field: 'readreceipts'|'profile'|'status'|'online'|'last'|'groupadd'|'calladd', value }` |
| PATCH | `/privacy/:id/disappearing-default` | `{ seconds }` |
| GET | `/privacy/:id/blocklist` | List blocked jids |
| POST | `/privacy/:id/:jid/block` | Block a contact |
| POST | `/privacy/:id/:jid/unblock` | Unblock a contact |

### Presence
| Method | Path | Description |
|---|---|---|
| POST | `/presence/:id/:jid/subscribe` | Subscribe to a contact's presence updates |
| POST | `/presence/:id/update` | `{ state: 'available'|'unavailable'|'composing'|'recording'|'paused', jid? }` |

### Contacts & Media
| Method | Path | Description |
|---|---|---|
| GET | `/contacts/:id` | List known contacts |
| GET | `/contacts/:id/:jid/profile-picture?highRes=true` | Profile picture URL |
| GET | `/contacts/:id/:jid/status` | About/status text |
| GET | `/contacts/:id/:jid/business-profile` | Business profile info |
| GET | `/media/:id/:jid/:messageId` | Streams a downloaded media file |

## Socket.IO events (room `session:<id>`)

`qr`, `connection.update`, `messages.upsert`, `messages.update`, `chats.upsert`,
`presence.update`, `group-participants.update`, `call`.

## Production notes

- Set `API_KEY` and put this service behind your own auth/rate limiting/gateway for real
  multi-tenant use — the built-in bearer check is intentionally minimal.
- Media is stored on local disk under `MEDIA_STORAGE_PATH`; mount a persistent volume (see
  `docker-compose.yml`) or swap `utils/mediaStorage.js` for S3/GCS if you need shared storage
  across instances.
- `REDIS_ENABLED=true` wires a Socket.IO Redis adapter for multi-instance realtime broadcast.
  The WhatsApp sockets themselves are still pinned to one Node process per session — plan your
  load balancing (consistent hashing on `sessionId`) accordingly if you scale horizontally.
- Logs are structured JSON via pino in production (pretty-printed in dev), tagged with
  `sessionId` for per-account filtering.
- Reconnection uses exponential backoff and distinguishes `loggedOut` (stop, clear auth) from
  any other close reason (reconnect).
