const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/promoController');

// Admin only
router.post('/', authenticate, requireRole('admin'), c.createPromo);
router.get('/', authenticate, requireRole('admin'), c.listPromos);
router.delete('/:id', authenticate, requireRole('admin'), c.deletePromo);

// Any authenticated user — validate before payment
router.post('/validate', authenticate, c.validatePromo);

module.exports = router;
