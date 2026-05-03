const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { singleImageUpload, requireFile } = require('../middleware/imageUpload');
const c = require('../controllers/maintenanceController');
const c2 = require('../controllers/advancePaymentController');

router.post('/bills', authenticate, requireRole('pramukh', 'admin'), c.addBill);
router.patch('/bills', authenticate, requireRole('pramukh', 'admin'), c.updateBill);
router.delete('/bills/:id', authenticate, requireRole('admin'), c.deleteBill);
router.get('/bills', authenticate, c.getBills);
router.get('/payments', authenticate, c.getPaymentRecords);
router.patch('/payments/:id/receipt', authenticate, requireRole('user', 'pramukh'), c.uploadReceipt);
router.patch('/payments/:id/approve', authenticate, requireRole('pramukh', 'admin'), c.approvePayment);

// Upload receipt image endpoint
router.post('/upload-receipt', 
  authenticate, 
  requireRole('user', 'pramukh'), 
  ...singleImageUpload('receipt'),
  requireFile,
  c.uploadReceiptImage
);
router.post('/pay/order', authenticate, requireRole('user', 'pramukh'), c.createPaymentOrder);
router.post('/pay/phonepe-callback', c.phonepeCallback);          // PhonePe Redirect
router.get('/pay/phonepe-callback', c.phonepeCallback);           // GET fallback
router.get('/receipt/:payment_record_id', authenticate, c.downloadReceipt);
router.post('/reminder', authenticate, requireRole('pramukh', 'admin'), c.sendReminder);
router.get('/report/:bill_id', authenticate, requireRole('pramukh', 'admin'), c.getReport);
router.get('/transfer-status', authenticate, requireRole('pramukh', 'admin'), c.getTransferStatus);

// Advance payment routes
router.get('/advance/status', authenticate, requireRole('user', 'pramukh'), c2.getAdvanceStatus);
router.post('/advance/order', authenticate, requireRole('user', 'pramukh'), c2.createAdvanceOrder);
router.post('/advance/phonepe-callback', c2.phonepeCallback);
router.get('/advance/phonepe-callback', c2.phonepeCallback);
router.get('/advance/summary', authenticate, requireRole('pramukh', 'admin'), c2.getAdvanceSummary);

module.exports = router;
