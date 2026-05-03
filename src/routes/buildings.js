const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/buildingController');

router.post('/', authenticate, requireRole('admin'), c.createBuilding);
router.post('/create', authenticate, requireRole('admin'), c.createBuildingOnly);
router.post('/pramukh', authenticate, requireRole('admin'), c.createPramukh);
router.get('/my', authenticate, c.getMyBuilding);
router.get('/', authenticate, requireRole('admin'), c.getAllBuildings);
router.get('/search', authenticate, c.searchBuildings);
router.post('/join', authenticate, requireRole('user'), c.requestJoin);
router.post('/join/handle', authenticate, requireRole('pramukh'), c.handleJoinRequest);
router.get('/members/:building_id?', authenticate, requireRole('pramukh', 'admin', 'user'), c.getBuildingMembers);
router.get('/join/pending', authenticate, requireRole('pramukh'), c.getPendingRequests);
router.get('/bank-details', authenticate, requireRole('admin'), c.getBankDetails);
router.post('/bank-details', authenticate, requireRole('admin'), c.saveBankDetails);

// Admin: user management
router.get('/admin/users', authenticate, requireRole('admin'), c.getAllUsers);
router.post('/admin/users', authenticate, requireRole('admin'), c.adminCreateUser);
router.delete('/admin/users/:user_id', authenticate, requireRole('admin'), c.adminDeleteUser);

module.exports = router;
