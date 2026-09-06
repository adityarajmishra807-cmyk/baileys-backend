const router = require('express').Router();
const multer = require('multer');
const ctrl = require('../controllers/message.controller');
const asyncHandler = require('../middleware/asyncHandler');
const env = require('../config/env');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
});

router.get('/:sessionId/:jid/history', asyncHandler(ctrl.history));
router.post('/:sessionId/:jid/send', upload.single('file'), asyncHandler(ctrl.send));
router.post('/:sessionId/:jid/read', asyncHandler(ctrl.markRead));
router.patch('/:sessionId/:jid/:messageId', asyncHandler(ctrl.edit));
router.delete('/:sessionId/:jid/:messageId', asyncHandler(ctrl.remove));
router.post('/:sessionId/:jid/:messageId/react', asyncHandler(ctrl.react));

module.exports = router;
