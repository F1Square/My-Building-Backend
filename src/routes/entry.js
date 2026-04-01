const router = require('express').Router();
const { visitorSelfEntry, getBuildingInfo, getBuildingInfoJson } = require('../controllers/entryController');
const rateLimiter = require('../middleware/rateLimiter');

// Public routes — no auth (QR code based)
// Rate limited to 20 entries per minute per IP to prevent abuse
router.get('/building/:building_id/info', getBuildingInfoJson);   // JSON — for visitor-web
router.get('/building/:building_id', getBuildingInfo);            // HTML — legacy app QR
router.post('/building/:building_id', rateLimiter(20, 60_000), visitorSelfEntry);

module.exports = router;
