const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { addAnnouncement, getAnnouncements } = require('../controllers/announcementController');

router.post('/', authenticate, requireRole('pramukh', 'admin'), addAnnouncement);
router.get('/', authenticate, getAnnouncements);

module.exports = router;
