const router = require('express').Router();
const ctrl = require('../controllers/group.controller');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/:sessionId', asyncHandler(ctrl.list));
router.post('/:sessionId', asyncHandler(ctrl.create));
router.get('/:sessionId/:jid', asyncHandler(ctrl.metadata));
router.patch('/:sessionId/:jid/subject', asyncHandler(ctrl.updateSubject));
router.patch('/:sessionId/:jid/description', asyncHandler(ctrl.updateDescription));
router.post('/:sessionId/:jid/participants', asyncHandler(ctrl.participants));
router.patch('/:sessionId/:jid/setting', asyncHandler(ctrl.updateSetting));
router.get('/:sessionId/:jid/invite-code', asyncHandler(ctrl.inviteCode));
router.post('/:sessionId/:jid/invite-code/revoke', asyncHandler(ctrl.revokeInviteCode));
router.post('/:sessionId/join', asyncHandler(ctrl.joinViaInvite));
router.post('/:sessionId/:jid/leave', asyncHandler(ctrl.leave));
router.patch('/:sessionId/:jid/ephemeral', asyncHandler(ctrl.ephemeral));

module.exports = router;
