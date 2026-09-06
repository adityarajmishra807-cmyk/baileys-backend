const env = require('../config/env');

/**
 * Minimal bearer-token guard for the REST API. Swap this for your real
 * auth/RBAC (JWT, session, per-tenant API keys in a DB, etc) in production —
 * this exists so the service isn't wide open by default.
 */
function apiKeyAuth(req, res, next) {
  if (!env.API_KEY) return next(); // no key configured (dev convenience) — skip
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (token !== env.API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  return next();
}

module.exports = apiKeyAuth;
