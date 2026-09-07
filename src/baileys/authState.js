const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const authCredsRepo = require('../repositories/authCreds.repo');
const authKeyRepo = require('../repositories/authKey.repo');
const lidMappingRepo = require('../repositories/lidMapping.repo');

// Serialize/deserialize through Baileys' BufferJSON replacer/reviver so that
// Uint8Array/Buffer key material survives the trip through Postgres jsonb.
const serialize = (data) => JSON.parse(JSON.stringify(data, BufferJSON.replacer));
const deserialize = (data) => JSON.parse(JSON.stringify(data), BufferJSON.reviver);

/**
 * Database-backed AuthenticationState. Both creds and every Signal key type
 * are persisted; in particular `lid-mapping` is mirrored into lid_mappings so
 * the application layer can resolve @lid JIDs without guessing phone numbers.
 */
async function useSupabaseAuthState(sessionId) {
  const storedCreds = await authCredsRepo.get(sessionId);
  const creds = storedCreds ? deserialize(storedCreds) : initAuthCreds();

  const saveCreds = async () => {
    await authCredsRepo.upsert(sessionId, serialize(creds));
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

    set: async (data) => {
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
      if (lidEntries.length) {
        await lidMappingRepo.upsertBaileysKeyEntries(sessionId, lidEntries);
      }
    },

    clear: async () => {
      await authKeyRepo.clearAll(sessionId);
      await lidMappingRepo.deleteAllForSession(sessionId);
    },
  };

  return {
    state: { creds, keys },
    saveCreds,
  };
}

/** Wipes all persisted auth material for a session — used on logout / delete. */
async function clearAuthState(sessionId) {
  await Promise.all([
    authCredsRepo.remove(sessionId),
    authKeyRepo.clearAll(sessionId),
    lidMappingRepo.deleteAllForSession(sessionId),
  ]);
}

module.exports = { useSupabaseAuthState, clearAuthState };
