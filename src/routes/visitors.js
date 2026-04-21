const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { addVisitor, getVisitors, getVisitorDates, uploadVisitorPhoto } = require('../controllers/visitorController');
const { singleImageUpload, requireFile } = require('../middleware/imageUpload');

router.post('/', authenticate, requireRole('watchman'), addVisitor);
router.get('/', authenticate, requireRole('pramukh', 'user', 'admin'), getVisitors);
router.get('/dates', authenticate, requireRole('pramukh', 'user', 'admin'), getVisitorDates);

// Upload visitor photo endpoint
router.post('/upload-photo', 
  authenticate, 
  requireRole('watchman'), 
  ...singleImageUpload('photo'),
  requireFile,
  uploadVisitorPhoto
);

module.exports = router;
