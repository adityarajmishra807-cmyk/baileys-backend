const router = require('express').Router();
const ctrl = require('../controllers/session.controller');
const asyncHandler = require('../middleware/asyncHandler');
const { sessionLimiter } = require('../middleware/rateLimiters');

router.get('/', asyncHandler(ctrl.list));
router.post('/realtime-token', sessionLimiter, asyncHandler(ctrl.realtimeToken));
router.post('/:sessionId/start', sessionLimiter, asyncHandler(ctrl.start));
router.get('/:sessionId/status', asyncHandler(ctrl.status));
router.post('/:sessionId/logout', sessionLimiter, asyncHandler(ctrl.logout));
router.delete('/:sessionId', sessionLimiter, asyncHandler(ctrl.remove));
router.post('/:sessionId/check-numbers', sessionLimiter, asyncHandler(ctrl.checkNumbers));

module.exports = router;
