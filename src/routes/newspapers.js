const router = require('express').Router();
const multer = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/newspaperController');

// User/Pramukh/Admin: list editions for a date+language
router.get('/', authenticate, c.listEditions);

// User/Pramukh/Admin: get available dates (for calendar highlighting)
router.get('/available-dates', authenticate, c.getAvailableDates);

// Admin: list recent editions
router.get('/recent', authenticate, requireRole('admin'), c.getRecentEditions);

// User/Pramukh/Admin: open one edition by id (signed URL)
router.get('/item/:id', authenticate, c.getEditionById);

// Admin: upload or link edition (clear 413 when PDF exceeds newspaper limit)
router.post('/', authenticate, requireRole('admin'), (req, res, next) => {
  c.upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      const maxMb = Math.round(c.MAX_NEWSPAPER_PDF_BYTES / (1024 * 1024));
      return res.status(413).json({ error: `PDF must be under ${maxMb}MB` });
    }
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, c.uploadEdition);

// Admin: delete edition
router.delete('/:id', authenticate, requireRole('admin'), c.deleteEdition);

// Admin: get/save URL patterns
router.get('/url-patterns', authenticate, requireRole('admin'), c.getUrlPatterns);
router.put('/url-patterns', authenticate, requireRole('admin'), c.saveUrlPatterns);

module.exports = router;
