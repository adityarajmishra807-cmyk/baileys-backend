const router = require('express').Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');

const sessionRoutes = require('./session.routes');
const messageRoutes = require('./message.routes');
const chatRoutes = require('./chat.routes');
const groupRoutes = require('./group.routes');
const privacyRoutes = require('./privacy.routes');
const presenceRoutes = require('./presence.routes');
const contactRoutes = require('./contact.routes');
const mediaRoutes = require('./media.routes');

router.use(apiKeyAuth);

router.use('/sessions', sessionRoutes);
router.use('/messages', messageRoutes);
router.use('/chats', chatRoutes);
router.use('/groups', groupRoutes);
router.use('/privacy', privacyRoutes);
router.use('/presence', presenceRoutes);
router.use('/contacts', contactRoutes);
router.use('/media', mediaRoutes);

module.exports = router;
