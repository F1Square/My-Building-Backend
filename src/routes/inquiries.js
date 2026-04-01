const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { submitInquiry, getInquiries, updateInquiryStatus } = require('../controllers/inquiryController');

router.post('/', authenticate, requireRole('user', 'pramukh'), submitInquiry);
router.get('/', authenticate, requireRole('admin'), getInquiries);
router.patch('/:id/status', authenticate, requireRole('admin'), updateInquiryStatus);

module.exports = router;
