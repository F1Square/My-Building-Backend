const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { getNotifications, markRead, markAllRead, getUnreadCounts, markReadByTypes } = require('../controllers/notificationController');

router.get('/', authenticate, getNotifications);
router.get('/unread-counts', authenticate, getUnreadCounts);
router.patch('/read-all', authenticate, markAllRead);
router.patch('/read-by-types', authenticate, markReadByTypes);
router.patch('/:id/read', authenticate, markRead);

module.exports = router;
