const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { submitComplaint, getComplaints, updateComplaintStatus, deleteComplaint } = require('../controllers/complaintController');

router.post('/', authenticate, requireRole('user', 'pramukh', 'admin'), submitComplaint);
router.get('/', authenticate, getComplaints);
router.patch('/status', authenticate, requireRole('pramukh', 'admin'), updateComplaintStatus);
router.delete('/:id', authenticate, requireRole('admin'), deleteComplaint);

module.exports = router;
