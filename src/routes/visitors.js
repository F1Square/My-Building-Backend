const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { addVisitor, getVisitors, getVisitorDates } = require('../controllers/visitorController');

router.post('/', authenticate, requireRole('watchman'), addVisitor);
router.get('/', authenticate, requireRole('pramukh', 'user', 'admin'), getVisitors);
router.get('/dates', authenticate, requireRole('pramukh', 'user', 'admin'), getVisitorDates);

module.exports = router;
