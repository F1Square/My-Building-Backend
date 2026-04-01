const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { addMeeting, getMeetings } = require('../controllers/meetingController');

router.post('/', authenticate, requireRole('pramukh'), addMeeting);
router.get('/', authenticate, getMeetings);

module.exports = router;
