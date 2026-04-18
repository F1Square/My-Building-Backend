const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/maintenanceController');
const c2 = require('../controllers/advancePaymentController');

router.post('/bills', authenticate, requireRole('pramukh', 'admin'), c.addBill);
router.patch('/bills', authenticate, requireRole('pramukh', 'admin'), c.updateBill);
router.delete('/bills/:id', authenticate, requireRole('admin'), c.deleteBill);
router.get('/bills', authenticate, c.getBills);
router.get('/payments', authenticate, c.getPaymentRecords);
router.patch('/payments/:id/receipt', authenticate, requireRole('user', 'pramukh'), c.uploadReceipt);
router.post('/pay/order', authenticate, requireRole('user', 'pramukh'), c.createPaymentOrder);
router.get('/pay/checkout/:order_id', c.checkoutPage);   // serves HTML page — no auth (opened in browser)
router.post('/pay/callback', c.paymentCallback);          // called via fetch from checkout page
router.get('/pay/callback', c.paymentCallback);           // GET fallback
router.post('/pay/verify', authenticate, requireRole('user'), c.verifyPayment);
router.get('/receipt/:payment_record_id', authenticate, c.downloadReceipt);
router.post('/reminder', authenticate, requireRole('pramukh', 'admin'), c.sendReminder);
router.get('/report/:bill_id', authenticate, requireRole('pramukh', 'admin'), c.getReport);

// Advance payment routes
router.get('/advance/status', authenticate, requireRole('user', 'pramukh'), c2.getAdvanceStatus);
router.post('/advance/order', authenticate, requireRole('user', 'pramukh'), c2.createAdvanceOrder);
router.get('/advance/checkout/:order_id', c2.advancePaymentCheckout);
router.post('/advance/callback', c2.advancePaymentCallback);
router.get('/advance/summary', authenticate, requireRole('pramukh', 'admin'), c2.getAdvanceSummary);

module.exports = router;
