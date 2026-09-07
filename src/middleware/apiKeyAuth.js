const env = require('../config/env');

const AUTH_WINDOW_MS = 60 * 1000;
const AUTH_MAX_FAILURES = 5;
const failures = new Map();

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function isAuthRateLimited(ip) {
  const now = Date.now();
  const entry = failures.get(ip);

  if (!entry || now - entry.startedAt >= AUTH_WINDOW_MS) {
    failures.set(ip, { startedAt: now, count: 0 });
    return false;
  }

  return entry.count >= AUTH_MAX_FAILURES;
}

function recordAuthFailure(ip) {
  const now = Date.now();
  const entry = failures.get(ip);

  if (!entry || now - entry.startedAt >= AUTH_WINDOW_MS) {
    failures.set(ip, { startedAt: now, count: 1 });
    return;
  }

  entry.count += 1;
}

function clearAuthFailures(ip) {
  failures.delete(ip);
}

// Minimal bearer-token guard for the REST API. Swap this for your real
// auth/RBAC (JWT, session, per-tenant API keys in a DB, etc) in production —
// this exists so the service isn't wide open by default.
function apiKeyAuth(req, res, next) {
  if (!env.API_KEY) return next(); // no key configured (dev convenience) — skip

  const ip = getClientIp(req);
  if (isAuthRateLimited(ip)) {
    req.log?.warn?.({ ip, path: req.originalUrl }, 'Authentication rate limit exceeded');
    return res.status(429).json({
      success: false,
      error: 'Too many authentication attempts. Please try again later.',
      retryAfterSeconds: Math.ceil(AUTH_WINDOW_MS / 1000),
    });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;

  if (token !== env.API_KEY) {
    recordAuthFailure(ip);
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  clearAuthFailures(ip);
  return next();
}

module.exports = apiKeyAuth;
