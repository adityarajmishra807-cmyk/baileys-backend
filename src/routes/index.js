const router = require('express').Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');
const mediaAuth = require('../middleware/mediaAuth');

const sessionRoutes = require('./session.routes');
const messageRoutes = require('./message.routes');
const chatRoutes = require('./chat.routes');
const groupRoutes = require('./group.routes');
const privacyRoutes = require('./privacy.routes');
const presenceRoutes = require('./presence.routes');
const contactRoutes = require('./contact.routes');
const mediaRoutes = require('./media.routes');

// Media is mounted separately because browser <img>/<video> requests cannot
// send our custom Authorization header. mediaAuth accepts either the normal
// API key or a short-lived, session-scoped realtime token.
router.use('/media', mediaAuth, mediaRoutes);

router.use(apiKeyAuth);

router.use('/sessions', sessionRoutes);
router.use('/messages', messageRoutes);
router.use('/chats', chatRoutes);
router.use('/groups', groupRoutes);
router.use('/privacy', privacyRoutes);
router.use('/presence', presenceRoutes);
router.use('/contacts', contactRoutes);

module.exports = router;
