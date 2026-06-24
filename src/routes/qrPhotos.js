const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { singleImageUpload, requireFile } = require('../middleware/imageUpload');
const {
  uploadQRPhoto,
  getQRPhoto,
  recordQRShare
} = require('../controllers/qrPhotoController');

const router = express.Router();

// ============================================================
// Admin: Upload QR photo per society
// Authenticated, admin only
// ============================================================
router.post(
  '/:building_id/upload',
  authenticate,
  requireRole('admin'),
  ...singleImageUpload('photo'),
  requireFile,
  uploadQRPhoto
);

// ============================================================
// Get active QR photo for a building
// Authenticated, pramukh/user/admin only
// ============================================================
router.get(
  '/building/:building_id',
  authenticate,
  getQRPhoto
);

// ============================================================
// Record QR share action (for analytics)
// Authenticated, pramukh/user/admin only
// ============================================================
router.post(
  '/:building_id/share',
  authenticate,
  recordQRShare
);

module.exports = router;
