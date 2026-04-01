const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { sendMessage, getMessages, getNewMessages } = require('../controllers/chatController');

router.post('/', authenticate, requireRole('user', 'pramukh', 'admin'), sendMessage);
router.get('/new', authenticate, requireRole('user', 'pramukh', 'admin'), getNewMessages);
router.get('/', authenticate, requireRole('user', 'pramukh', 'admin'), getMessages);

module.exports = router;
