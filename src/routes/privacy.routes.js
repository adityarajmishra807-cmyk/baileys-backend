const router = require('express').Router();
const ctrl = require('../controllers/privacy.controller');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/:sessionId', asyncHandler(ctrl.getSettings));
router.patch('/:sessionId', asyncHandler(ctrl.updateSetting));
router.patch('/:sessionId/disappearing-default', asyncHandler(ctrl.updateDisappearingDefault));
router.get('/:sessionId/blocklist', asyncHandler(ctrl.getBlocklist));
router.post('/:sessionId/:jid/block', asyncHandler(ctrl.block));
router.post('/:sessionId/:jid/unblock', asyncHandler(ctrl.unblock));

module.exports = router;
