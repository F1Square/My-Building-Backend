const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/newspaperController');

// User/Pramukh/Admin: get edition for a date+language
router.get('/', authenticate, c.getEdition);

// User/Pramukh/Admin: get available dates (for calendar highlighting)
router.get('/available-dates', authenticate, c.getAvailableDates);

// Admin: list recent editions
router.get('/recent', authenticate, requireRole('admin'), c.getRecentEditions);

// Admin: upload or link edition
router.post('/', authenticate, requireRole('admin'), c.upload.single('file'), c.uploadEdition);

// Admin: delete edition
router.delete('/:id', authenticate, requireRole('admin'), c.deleteEdition);

// Admin: get/save URL patterns
router.get('/url-patterns', authenticate, requireRole('admin'), c.getUrlPatterns);
router.put('/url-patterns', authenticate, requireRole('admin'), c.saveUrlPatterns);

module.exports = router;
