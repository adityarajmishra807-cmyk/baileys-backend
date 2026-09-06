const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const authCredsRepo = require('../repositories/authCreds.repo');
const authKeyRepo = require('../repositories/authKey.repo');

// Serialize/deserialize through Baileys' BufferJSON replacer/reviver so that
// Buffers (raw key bytes) survive the trip through Postgres' jsonb storage.
const serialize = (data) => JSON.parse(JSON.stringify(data, BufferJSON.replacer));
const deserialize = (data) => JSON.parse(JSON.stringify(data), BufferJSON.reviver);

/**
 * Database-backed replacement for `useMultiFileAuthState`, following the pattern
 * Baileys recommends for production (see baileys.wiki session-management guide):
 * persist creds + signal keys in a real datastore instead of flat files, so
 * multiple app instances/pods can share and survive restarts/redeploys.
 */
async function useSupabaseAuthState(sessionId) {
  const storedCreds = await authCredsRepo.get(sessionId);
  let creds = storedCreds ? deserialize(storedCreds) : initAuthCreds();

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
      for (const type of Object.keys(data)) {
        for (const keyId of Object.keys(data[type])) {
          const value = data[type][keyId];
          entries.push({ type, keyId, value: value ? serialize(value) : null });
        }
      }
      if (entries.length) await authKeyRepo.applyBatch(sessionId, entries);
    },
    clear: async () => {
      await authKeyRepo.clearAll(sessionId);
    },
  };

  return {
    state: { creds, keys },
    saveCreds,
  };
}

/** Wipes all persisted auth material for a session — used on logout / delete. */
async function clearAuthState(sessionId) {
  await Promise.all([authCredsRepo.remove(sessionId), authKeyRepo.clearAll(sessionId)]);
}

module.exports = { useSupabaseAuthState, clearAuthState };
