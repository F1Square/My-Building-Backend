const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/referController');

router.get('/my-code', authenticate, requireRole('user', 'pramukh'), c.getMyCode);
router.get('/my-referrals', authenticate, requireRole('user', 'pramukh'), c.getMyReferrals);
router.get('/admin/all', authenticate, requireRole('admin'), c.adminGetAll);
router.post('/admin/grant-subscription', authenticate, requireRole('admin'), c.adminGrantSubscription);
router.post('/admin/add-gift-card', authenticate, requireRole('admin'), c.adminAddGiftCard);

module.exports = router;
