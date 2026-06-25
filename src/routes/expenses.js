const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/expenseController');

// Get all wings for a building
router.get('/wings', authenticate, c.getWings);

// All authenticated users can view
router.get('/summary', authenticate, c.getFundSummary);
router.get('/entries', authenticate, c.getEntries);

// Pramukh + admin can manage
router.post('/opening-balance', authenticate, requireRole('pramukh', 'admin'), c.setOpeningBalance);
router.post('/entries', authenticate, requireRole('pramukh', 'admin'), c.addEntry);
router.patch('/entries/:id', authenticate, requireRole('pramukh', 'admin'), c.editEntry);
router.delete('/entries/:id', authenticate, requireRole('pramukh', 'admin'), c.deleteEntry);

// Admin only — audit logs
router.get('/logs', authenticate, requireRole('admin', 'pramukh'), c.getEditLogs);

module.exports = router;
