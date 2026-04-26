const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/routesController');

// Create linked account for a building (admin only)
router.post('/linked-account', authenticate, requireRole('admin'), c.createLinkedAccount);

// Add bank account to linked account (admin only)
router.post('/bank-account', authenticate, requireRole('admin'), c.addBankAccount);

// Get linked account status (admin/pramukh)
router.get('/linked-account', authenticate, c.getLinkedAccount);

// Get all linked accounts (admin only)
router.get('/all-linked-accounts', authenticate, requireRole('admin'), c.getAllLinkedAccounts);

// Retry transfer for debugging (admin only)
router.post('/retry-transfer', authenticate, requireRole('admin'), c.retryTransfer);

module.exports = router;
