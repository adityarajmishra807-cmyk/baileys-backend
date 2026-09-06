const crypto = require('crypto');
const env = require('../config/env');

const TTL_SECONDS = 60 * 60;

function sign(payload) {
  return crypto.createHmac('sha256', env.SOCKET_TOKEN_SECRET).update(payload).digest('base64url');
}

function createToken(sessionIds) {
  const ids = [...new Set(sessionIds)].filter(Boolean);
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = JSON.stringify({ sessionIds: ids, exp });
  const encoded = Buffer.from(payload).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

function verifyToken(token) {
  if (!env.SOCKET_TOKEN_SECRET || typeof token !== 'string') return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!Array.isArray(payload.sessionIds)) return null;
    return { sessionIds: new Set(payload.sessionIds.map(String)), exp: payload.exp };
  } catch {
    return null;
  }
}

module.exports = { createToken, verifyToken };
