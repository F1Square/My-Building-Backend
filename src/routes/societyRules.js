const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/societyRulesController');

router.get('/', authenticate, c.getRules);
router.post('/', authenticate, requireRole('pramukh', 'admin'), c.createRule);
router.patch('/:id', authenticate, requireRole('pramukh', 'admin'), c.updateRule);
router.delete('/:id', authenticate, requireRole('pramukh', 'admin'), c.deleteRule);

module.exports = router;
