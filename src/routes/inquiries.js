const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');
const { submitInquiry, submitPublicInquiry, getInquiries, updateInquiryStatus } = require('../controllers/inquiryController');

// PUBLIC — from website registration form (no auth needed)
router.post('/public', rateLimiter(5, 60_000), submitPublicInquiry);

// Authenticated user submitting from app
router.post('/', authenticate, requireRole('user', 'pramukh'), submitInquiry);

// Admin
router.get('/', authenticate, requireRole('admin'), getInquiries);
router.patch('/:id/status', authenticate, requireRole('admin'), updateInquiryStatus);

module.exports = router;
