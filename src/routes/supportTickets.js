const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/supportTicketController');

router.post('/', authenticate, requireRole('user', 'pramukh'), c.createTicket);
router.get('/my', authenticate, requireRole('user', 'pramukh'), c.getMyTickets);
router.get('/admin', authenticate, requireRole('admin'), c.adminGetTickets);
router.patch('/:id/status', authenticate, requireRole('admin'), c.updateStatus);
router.post('/:id/messages', authenticate, requireRole('user', 'pramukh', 'admin'), c.addMessage);
router.get('/:id', authenticate, requireRole('user', 'pramukh', 'admin'), c.getTicketById);

module.exports = router;
