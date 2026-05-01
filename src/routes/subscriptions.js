const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/subscriptionController');

router.get('/me', authenticate, c.getMySubscription);
router.post('/order', authenticate, c.createOrder);
router.post('/phonepe-callback', c.phonepeCallback);
router.get('/phonepe-callback', c.phonepeCallback);

// Admin
router.get('/all', authenticate, requireRole('admin'), c.adminGetAll);
router.post('/grant', authenticate, requireRole('admin'), c.adminGrant);
router.post('/revoke', authenticate, requireRole('admin'), c.adminRevoke);

// Newspaper add-on toggle (existing subscribers)
router.post('/newspaper-addon', authenticate, requireRole('user', 'pramukh'), c.toggleNewspaperAddon);
// Newspaper add-on PhonePe order (₹3 charge)
router.post('/newspaper-addon/order', authenticate, requireRole('user', 'pramukh'), c.createNewspaperAddonOrder);

// Validate promo code (web-friendly alias)
router.post('/validate-promo', authenticate, c.validatePromoCode);

// Upgrade plan
router.post('/upgrade', authenticate, requireRole('user', 'pramukh'), c.upgradePlan);

module.exports = router;
