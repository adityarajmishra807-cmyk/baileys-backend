const authCredsRepo = require('../repositories/authCreds.repo');
const authKeyRepo = require('../repositories/authKey.repo');
const lidMappingRepo = require('../repositories/lidMapping.repo');
const { getBaileys } = require('./baileys');

// v7 uses base64 BufferJSON, while existing v6 sessions may contain the older
// { type: 'Buffer', data: number[] } representation. Support both so upgrading
// the backend does not silently corrupt a previously working session.
function deserializeStored(data, BufferJSON) {
  return JSON.parse(JSON.stringify(data), (key, value) => {
    if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    return BufferJSON.reviver(key, value);
  });
}

function serializeStored(data, BufferJSON) {
  return JSON.parse(JSON.stringify(data, BufferJSON.replacer));
}

// Baileys can issue several key mutations concurrently. Serialize persistence
// per WhatsApp session so a late DB operation can never overwrite a newer
// Signal/app-state transition.
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

async function mirrorLidMappings(sessionId, lidEntries) {
  if (!lidEntries?.length) return;
  try {
    await lidMappingRepo.upsertBaileysKeyEntries(sessionId, lidEntries);
  } catch (err) {
    // This table is an application/UI identity cache. Baileys' authoritative
    // Signal key store has already been persisted and must never fail because
    // the secondary mapping table/network is temporarily unavailable.
  }
}

async function useSupabaseAuthState(sessionId) {
  const { initAuthCreds, BufferJSON, proto } = await getBaileys();
  const storedCreds = await authCredsRepo.get(sessionId);
  const creds = storedCreds
    ? deserializeStored(storedCreds, BufferJSON)
    : initAuthCreds();

  // Backfill the application-level identity table from authoritative Baileys
  // LID mapping keys already persisted before this feature existed. A mapping
  // cache failure must not prevent the Signal auth state from loading.
  let storedLidKeys = [];
  try {
    storedLidKeys = await authKeyRepo.getAllByType(sessionId, 'lid-mapping');
  } catch (err) {
    storedLidKeys = [];
  }
  if (storedLidKeys.length) {
    await mirrorLidMappings(
      sessionId,
      storedLidKeys.map((row) => ({
        type: 'lid-mapping',
        keyId: row.key_id,
        value: String(row.value),
      })),
    );
  }

  const saveCreds = async () => {
    const snapshot = serializeStored(creds, BufferJSON);
    await enqueueSessionWrite(sessionId, () => authCredsRepo.upsert(sessionId, snapshot));
  };

  const keys = {
    get: async (type, ids) => {
      const found = await authKeyRepo.getMany(sessionId, type, ids);
      const result = {};
      for (const keyId of Object.keys(found)) {
        let value = deserializeStored(found[keyId], BufferJSON);
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
            value: value === null || value === undefined
              ? null
              : serializeStored(value, BufferJSON),
          });
          if (type === 'lid-mapping' && value !== null && value !== undefined) {
            lidEntries.push({ type, keyId, value: String(value) });
          }
        }
      }

      // Persist authoritative Signal/app-state keys first. Never let the
      // application-level LID mapping mirror reject this operation, because
      // Baileys depends on keys.set completing successfully to advance its
      // cryptographic state.
      if (entries.length) await authKeyRepo.applyBatch(sessionId, entries);
      if (lidEntries.length) await mirrorLidMappings(sessionId, lidEntries);
    }),

    clear: async () => enqueueSessionWrite(sessionId, async () => {
      await authKeyRepo.clearAll(sessionId);
      try { await lidMappingRepo.deleteAllForSession(sessionId); } catch (err) { /* secondary cache */ }
    }),
  };

  return { state: { creds, keys }, saveCreds };
}

async function clearAuthState(sessionId) {
  await enqueueSessionWrite(sessionId, async () => {
    await Promise.all([
      authCredsRepo.remove(sessionId),
      authKeyRepo.clearAll(sessionId),
    ]);
    try { await lidMappingRepo.deleteAllForSession(sessionId); } catch (err) { /* secondary cache */ }
  });
}

module.exports = { useSupabaseAuthState, clearAuthState };
