const express = require('express');
const router = express.Router();
const appConfigController = require('../controllers/appConfigController');
const { authenticate, requireRole } = require('../middleware/auth');

// This route should be public so app can check before login
router.get('/', appConfigController.getAppConfig);

// Admin only: update configuration
router.patch('/', authenticate, requireRole('admin'), appConfigController.updateAppConfig);

module.exports = router;
