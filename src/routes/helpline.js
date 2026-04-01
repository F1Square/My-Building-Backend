const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { getHelplines, addHelpline, deleteHelpline } = require('../controllers/helplineController');

router.get('/', authenticate, getHelplines);
router.post('/', authenticate, requireRole('pramukh', 'admin'), addHelpline);
router.delete('/:id', authenticate, requireRole('pramukh', 'admin'), deleteHelpline);

module.exports = router;
