const router = require('express').Router();
const ctrl = require('../controllers/media.controller');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/:sessionId/:jid/:messageId', asyncHandler(ctrl.download));

module.exports = router;
