const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { singleImageUpload, requireFile } = require('../middleware/imageUpload');
const c = require('../controllers/complaintController');

// User/Pramukh: create complaint
router.post('/', authenticate, requireRole('user', 'pramukh'), c.createComplaint);

// Upload complaint attachment endpoint
router.post('/upload-attachment', 
  authenticate, 
  requireRole('user', 'pramukh'), 
  ...singleImageUpload('attachment'),
  requireFile,
  c.uploadComplaintAttachment
);

// User: my complaints only
router.get('/my', authenticate, requireRole('user', 'pramukh'), c.getMyComplaints);

// User + Pramukh: all complaints for their building (society view)
router.get('/building', authenticate, requireRole('user', 'pramukh'), c.getBuildingComplaints);

// Admin routes (must be before /:id)
router.get('/admin', authenticate, requireRole('admin'), c.adminGetComplaints);
router.post('/admin', authenticate, requireRole('admin'), c.adminCreateComplaint);
router.put('/admin/:id', authenticate, requireRole('admin'), c.adminUpdateComplaint);
router.delete('/admin/:id', authenticate, requireRole('admin'), c.adminDeleteComplaint);

// Pramukh: update status + remark
router.patch('/:id/status', authenticate, requireRole('pramukh', 'admin'), c.updateComplaintStatus);

// Single complaint detail (must be last — :id would otherwise capture "admin", "my", etc.)
router.get('/:id', authenticate, requireRole('user', 'pramukh', 'admin'), c.getComplaintById);

module.exports = router;
