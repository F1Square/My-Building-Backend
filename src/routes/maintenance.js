const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/maintenanceController');

router.post('/bills', authenticate, requireRole('pramukh', 'admin'), c.addBill);
router.patch('/bills', authenticate, requireRole('pramukh', 'admin'), c.updateBill);
router.get('/bills', authenticate, c.getBills);
router.get('/payments', authenticate, c.getPaymentRecords);
router.post('/pay/order', authenticate, requireRole('user', 'pramukh'), c.createPaymentOrder);
router.get('/pay/checkout/:order_id', c.checkoutPage);   // serves HTML page — no auth (opened in browser)
router.post('/pay/callback', c.paymentCallback);          // called via fetch from checkout page
router.get('/pay/callback', c.paymentCallback);           // GET fallback
router.post('/pay/verify', authenticate, requireRole('user'), c.verifyPayment);
router.get('/receipt/:payment_record_id', authenticate, c.downloadReceipt);
router.post('/reminder', authenticate, requireRole('pramukh', 'admin'), c.sendReminder);

module.exports = router;
