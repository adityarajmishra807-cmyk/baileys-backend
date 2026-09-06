const router = require('express').Router();
const ctrl = require('../controllers/session.controller');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/', asyncHandler(ctrl.list));
router.post('/:sessionId/start', asyncHandler(ctrl.start));
router.get('/:sessionId/status', asyncHandler(ctrl.status));
router.post('/:sessionId/logout', asyncHandler(ctrl.logout));
router.delete('/:sessionId', asyncHandler(ctrl.remove));
router.post('/:sessionId/check-numbers', asyncHandler(ctrl.checkNumbers));

module.exports = router;
