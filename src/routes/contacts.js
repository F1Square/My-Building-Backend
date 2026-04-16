const router = require('express').Router();
const { submitContact, getContacts, updateContactStatus } = require('../controllers/contactController');
const { authenticate, requireRole } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');

// PUBLIC — website contact form (rate limited: 5 per minute per IP)
router.post('/', rateLimiter(5, 60_000), submitContact);

// ADMIN only
router.get('/', authenticate, requireRole('admin'), getContacts);
router.patch('/:id/status', authenticate, requireRole('admin'), updateContactStatus);

module.exports = router;
