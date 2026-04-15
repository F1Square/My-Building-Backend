const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/routesController');

// Create linked account for a building (pramukh/admin)
router.post('/linked-account', authenticate, requireRole('pramukh', 'admin'), c.createLinkedAccount);

// Add bank account to linked account
router.post('/bank-account', authenticate, requireRole('pramukh', 'admin'), c.addBankAccount);

// Get linked account status
router.get('/linked-account', authenticate, requireRole('pramukh', 'admin'), c.getLinkedAccount);

module.exports = router;
