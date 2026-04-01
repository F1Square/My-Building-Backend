const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { setFund, getFund } = require('../controllers/fundController');

router.post('/', authenticate, requireRole('pramukh'), setFund);
router.get('/', authenticate, getFund);

module.exports = router;
