const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/routesController');

// Get account status (admin/pramukh)
router.get('/account-status', authenticate, c.getAccountStatus);

// Retry transfer for debugging (admin only)
router.post('/retry-transfer', authenticate, requireRole('admin'), c.retryTransfer);

module.exports = router;
