const router = require('express').Router();
const verifyJWT = require('../middleware/verifyJWT');
const verifyAdmin = require('../middleware/verifyAdmin');
const {
    saveUser, getUserRole, getUserProfile, getUserStats,
    getAllUsers, updateUserRole, updateUserStatus
} = require('../controllers/userController');

router.post('/', saveUser);
router.get('/stats', verifyJWT, verifyAdmin, getUserStats);   // must be before /:email
router.get('/', verifyJWT, verifyAdmin, getAllUsers);
router.get('/:email/role', verifyJWT, getUserRole);
router.get('/:email/profile', verifyJWT, getUserProfile);
router.patch('/:id/role', verifyJWT, verifyAdmin, updateUserRole);
router.patch('/:id/status', verifyJWT, verifyAdmin, updateUserStatus);

module.exports = router;
