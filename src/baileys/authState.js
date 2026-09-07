const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const authCredsRepo = require('../repositories/authCreds.repo');
const authKeyRepo = require('../repositories/authKey.repo');
const lidMappingRepo = require('../repositories/lidMapping.repo');

const serialize = (data) => JSON.parse(JSON.stringify(data, BufferJSON.replacer));
const deserialize = (data) => JSON.parse(JSON.stringify(data), BufferJSON.reviver);

// Baileys can issue several key mutations concurrently. Supabase upserts are
// atomic per row, but delete/upsert ordering is still significant for Signal
// and app-state keys. Serialize persistence per WhatsApp session so a late DB
// operation can never overwrite a newer state transition.
const sessionWriteQueues = new Map();

function enqueueSessionWrite(sessionId, task) {
  const previous = sessionWriteQueues.get(sessionId) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  sessionWriteQueues.set(sessionId, current);

  return current.finally(() => {
    if (sessionWriteQueues.get(sessionId) === current) {
      sessionWriteQueues.delete(sessionId);
    }
  });
}

/**
 * Database-backed AuthenticationState. Both creds and every Signal key type
 * are persisted; `lid-mapping` is also mirrored into the application table.
 */
async function useSupabaseAuthState(sessionId) {
  const storedCreds = await authCredsRepo.get(sessionId);
  const creds = storedCreds ? deserialize(storedCreds) : initAuthCreds();

  // Backfill the application-level identity table from the authoritative
  // Baileys Signal mapping keys already persisted before this feature existed.
  const storedLidKeys = await authKeyRepo.getAllByType(sessionId, 'lid-mapping');
  if (storedLidKeys.length) {
    await lidMappingRepo.upsertBaileysKeyEntries(
      sessionId,
      storedLidKeys.map((row) => ({
        type: 'lid-mapping',
        keyId: row.key_id,
        value: String(row.value),
      })),
    );
  }

  const saveCreds = async () => {
    const snapshot = serialize(creds);
    await enqueueSessionWrite(sessionId, () => authCredsRepo.upsert(sessionId, snapshot));
  };

  const keys = {
    get: async (type, ids) => {
      const found = await authKeyRepo.getMany(sessionId, type, ids);
      const result = {};
      for (const keyId of Object.keys(found)) {
        let value = deserialize(found[keyId]);
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        result[keyId] = value;
      }
      return result;
    },

    set: async (data) => enqueueSessionWrite(sessionId, async () => {
      const entries = [];
      const lidEntries = [];

      for (const type of Object.keys(data || {})) {
        const values = data[type] || {};
        for (const keyId of Object.keys(values)) {
          const value = values[keyId];
          entries.push({
            type,
            keyId,
            value: value === null || value === undefined ? null : serialize(value),
          });
          if (type === 'lid-mapping' && value !== null && value !== undefined) {
            lidEntries.push({ type, keyId, value: String(value) });
          }
        }
      }

      if (entries.length) await authKeyRepo.applyBatch(sessionId, entries);
      if (lidEntries.length) await lidMappingRepo.upsertBaileysKeyEntries(sessionId, lidEntries);
    }),

    clear: async () => enqueueSessionWrite(sessionId, async () => {
      await authKeyRepo.clearAll(sessionId);
      await lidMappingRepo.deleteAllForSession(sessionId);
    }),
  };

  return { state: { creds, keys }, saveCreds };
}

async function clearAuthState(sessionId) {
  await enqueueSessionWrite(sessionId, async () => {
    await Promise.all([
      authCredsRepo.remove(sessionId),
      authKeyRepo.clearAll(sessionId),
      lidMappingRepo.deleteAllForSession(sessionId),
    ]);
  });
}

module.exports = { useSupabaseAuthState, clearAuthState };
