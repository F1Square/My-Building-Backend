const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/routesController');

// Create linked account for a building (admin only)
router.post('/linked-account', authenticate, requireRole('admin'), c.createLinkedAccount);

// Add bank account to linked account (admin only)
router.post('/bank-account', authenticate, requireRole('admin'), c.addBankAccount);

// Get linked account status (admin only)
router.get('/linked-account', authenticate, requireRole('admin'), c.getLinkedAccount);

module.exports = router;
