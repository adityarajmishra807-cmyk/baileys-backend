// Wraps async route handlers so rejected promises reach Express's error middleware
// instead of crashing the process with an unhandled rejection.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
