const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/subscriptionController');

router.get('/me', authenticate, c.getMySubscription);
router.post('/order', authenticate, c.createOrder);
router.post('/verify', authenticate, c.verifyAndActivate);
router.get('/checkout/:order_id', c.checkoutPage);
router.post('/callback', c.paymentCallback);

// Admin
router.get('/all', authenticate, requireRole('admin'), c.adminGetAll);
router.post('/grant', authenticate, requireRole('admin'), c.adminGrant);
router.post('/revoke', authenticate, requireRole('admin'), c.adminRevoke);

// Newspaper add-on toggle (existing subscribers)
router.post('/newspaper-addon', authenticate, requireRole('user', 'pramukh'), c.toggleNewspaperAddon);
// Newspaper add-on Razorpay order (₹3 charge)
router.post('/newspaper-addon/order', authenticate, requireRole('user', 'pramukh'), c.createNewspaperAddonOrder);
router.post('/newspaper-addon/callback', c.newspaperAddonCallback);

module.exports = router;
