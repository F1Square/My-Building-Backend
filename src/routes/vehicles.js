const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/vehicleController');

router.post('/', authenticate, requireRole('user', 'pramukh'), c.addVehicle);
router.get('/mine', authenticate, requireRole('user', 'pramukh'), c.getMyVehicles);
router.patch('/:id', authenticate, requireRole('user', 'pramukh'), c.updateVehicle);
router.delete('/:id', authenticate, requireRole('user', 'pramukh'), c.deleteVehicle);
router.get('/building', authenticate, requireRole('pramukh', 'admin', 'user'), c.getBuildingVehicles);
router.post('/report', authenticate, requireRole('user', 'pramukh', 'admin'), c.reportParking);
router.get('/reports', authenticate, requireRole('pramukh', 'admin', 'user'), c.getParkingReports);
router.post('/reminder', authenticate, requireRole('pramukh', 'admin'), c.sendParkingReminder);
// Admin: manage any vehicle
router.patch('/admin/:id', authenticate, requireRole('admin'), c.adminUpdateVehicle);
router.delete('/admin/:id', authenticate, requireRole('admin'), c.adminDeleteVehicle);

module.exports = router;
