const rateLimit = require('express-rate-limit');

const WINDOW_MS = 60 * 1000;

function createLimiter({ max, message }) {
  return rateLimit({
    windowMs: WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      req.log?.warn?.(
        { method: req.method, path: req.originalUrl, ip: req.ip, limit: max },
        'Rate limit exceeded'
      );

      res.status(429).json({
        success: false,
        error: message,
        retryAfterSeconds: Math.ceil(WINDOW_MS / 1000),
      });
    },
  });
}

// General application/API protection. The current backend uses a shared API key
// rather than per-user identity, so these limits are IP-based until real auth/RBAC
// is introduced.
const apiLimiter = createLimiter({
  max: 100,
  message: 'Too many API requests. Please try again later.',
});

const authLimiter = createLimiter({
  max: 5,
  message: 'Too many authentication attempts. Please try again later.',
});

const crmReadLimiter = createLimiter({
  max: 120,
  message: 'Too many read requests. Please try again later.',
});

const writeLimiter = createLimiter({
  max: 60,
  message: 'Too many write requests. Please try again later.',
});

const bulkLimiter = createLimiter({
  max: 30,
  message: 'Too many bulk operation requests. Please try again later.',
});

const adminLimiter = createLimiter({
  max: 30,
  message: 'Too many admin requests. Please try again later.',
});

// Existing WhatsApp-specific limiters are intentionally retained unchanged.
const sendLimiter = createLimiter({
  max: 30,
  message: 'Too many messages sent. Please try again later.',
});

const sessionLimiter = createLimiter({
  max: 20,
  message: 'Too many session operations. Please try again later.',
});

const mediaLimiter = createLimiter({
  max: 20,
  message: 'Too many media uploads. Please try again later.',
});

module.exports = {
  apiLimiter,
  authLimiter,
  crmReadLimiter,
  writeLimiter,
  bulkLimiter,
  adminLimiter,
  sendLimiter,
  sessionLimiter,
  mediaLimiter,
};
