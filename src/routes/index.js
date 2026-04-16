const express = require('express');
const router = express.Router();

// Activity logger runs here — after JWT auth middleware has set req.user
router.use(require('../middleware/activityLog'));

router.use('/auth', require('./auth'));
router.use('/buildings', require('./buildings'));
router.use('/visitors', require('./visitors'));
router.use('/maintenance', require('./maintenance'));
router.use('/requests', require('./requests'));
router.use('/funds', require('./funds'));
router.use('/meetings', require('./meetings'));
router.use('/chat', require('./chat'));
router.use('/vehicles', require('./vehicles'));
router.use('/notifications', require('./notifications'));
router.use('/announcements', require('./announcements'));
router.use('/inquiries', require('./inquiries'));
router.use('/subscriptions', require('./subscriptions'));
router.use('/helpline', require('./helpline'));
router.use('/expenses', require('./expenses'));
router.use('/promos', require('./promos'));
router.use('/complaints', require('./complaints'));
router.use('/activity-logs', require('./activityLogs'));
router.use('/routes', require('./routes'));
router.use('/contacts', require('./contacts'));
router.use('/refer', require('./refer'));

module.exports = router;
