const router = require('express').Router();
const ctrl = require('../controllers/presence.controller');
const asyncHandler = require('../middleware/asyncHandler');

router.post('/:sessionId/:jid/subscribe', asyncHandler(ctrl.subscribe));
router.post('/:sessionId/update', asyncHandler(ctrl.update));

module.exports = router;
