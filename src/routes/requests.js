const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { submitRequest, getRequests, updateRequestStatus } = require('../controllers/requestController');

router.post('/', authenticate, requireRole('user'), submitRequest);
router.get('/', authenticate, getRequests);
router.patch('/status', authenticate, requireRole('pramukh'), updateRequestStatus);

module.exports = router;
