const env = require('../config/env');
const { verifyToken } = require('../sockets/token');

/**
 * Media endpoints are consumed by <img>/<video> tags, which cannot attach a
 * custom Authorization header. Accept either the normal API key bearer token
 * or a short-lived session-scoped realtime token in the query string.
 */
function mediaAuth(req, res, next) {
  if (!env.API_KEY) return next();

  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (bearer === env.API_KEY) return next();

  const token = typeof req.query.realtimeToken === 'string' ? req.query.realtimeToken : '';
  const realtime = verifyToken(token);
  if (!realtime) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const { sessionId } = req.params;
  if (!sessionId || !realtime.sessionIds.has(String(sessionId))) {
    return res.status(403).json({ success: false, error: 'Session is not authorized for this media URL' });
  }

  return next();
}

module.exports = mediaAuth;
