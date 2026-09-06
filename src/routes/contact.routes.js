const router = require('express').Router();
const ctrl = require('../controllers/contact.controller');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/:sessionId', asyncHandler(ctrl.list));
router.get('/:sessionId/:jid/profile-picture', asyncHandler(ctrl.profilePicture));
router.get('/:sessionId/:jid/status', asyncHandler(ctrl.status));
router.get('/:sessionId/:jid/business-profile', asyncHandler(ctrl.businessProfile));

module.exports = router;
