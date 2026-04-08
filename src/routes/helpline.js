const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { getHelplines, addHelpline, updateHelpline, deleteHelpline } = require('../controllers/helplineController');

router.get('/', authenticate, getHelplines);
router.post('/', authenticate, requireRole('pramukh', 'admin'), addHelpline);
router.patch('/:id', authenticate, requireRole('pramukh', 'admin'), updateHelpline);
router.delete('/:id', authenticate, requireRole('pramukh', 'admin'), deleteHelpline);

module.exports = router;
