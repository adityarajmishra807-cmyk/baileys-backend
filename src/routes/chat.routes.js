const router = require('express').Router();
const ctrl = require('../controllers/chat.controller');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/:sessionId', asyncHandler(ctrl.list));
router.get('/:sessionId/:jid', asyncHandler(ctrl.get));
router.patch('/:sessionId/:jid', asyncHandler(ctrl.updateChatModifier));
router.delete('/:sessionId/:jid', asyncHandler(ctrl.remove));
router.delete('/:sessionId/:jid/messages', asyncHandler(ctrl.clearMessages));

module.exports = router;
