const { rootLogger } = require('../config/logger');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  rootLogger.error({ err, path: req.path, method: req.method }, 'Request error');
  res.status(statusCode).json({
    success: false,
    error: statusCode >= 500 ? 'Internal server error' : err.message,
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: 'Route not found' });
}

module.exports = { errorHandler, notFoundHandler };
