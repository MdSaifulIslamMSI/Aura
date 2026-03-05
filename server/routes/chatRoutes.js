const express = require('express');
const router = express.Router();
const { handleChat, handlePublicChat } = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');

const publicChatLimiter = createDistributedRateLimit({
    name: 'chat_public',
    windowMs: 60 * 1000,
    max: 20,
    message: 'Too many public chat requests. Please try again shortly.',
});

const privateChatLimiter = createDistributedRateLimit({
    name: 'chat_private',
    windowMs: 60 * 1000,
    max: 60,
    message: 'Too many chat requests. Please slow down.',
    keyGenerator: (req) => req.user?._id?.toString() || req.ip,
});

router.post('/public', publicChatLimiter, handlePublicChat);
router.post('/', protect, privateChatLimiter, handleChat);

module.exports = router;
