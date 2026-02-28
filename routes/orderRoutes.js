const router = require('express').Router();
const verifyJWT = require('../middleware/verifyJWT');
const verifyAdmin = require('../middleware/verifyAdmin');
const verifyManager = require('../middleware/verifyManager');
const {
    getOrderStats, getAllOrders, getPendingOrders, getApprovedOrders,
    getManagerOrders, getMyOrders, createOrder, getOrderById,
    approveOrder, rejectOrder, cancelOrder
} = require('../controllers/orderController');

// Specific paths before /:id
router.get('/stats', verifyJWT, verifyAdmin, getOrderStats);
router.get('/all', verifyJWT, verifyAdmin, getAllOrders);
router.get('/pending', verifyJWT, verifyManager, getPendingOrders);
router.get('/approved', verifyJWT, verifyManager, getApprovedOrders);
router.get('/manager/all', verifyJWT, verifyManager, getManagerOrders);
router.get('/my-orders', verifyJWT, getMyOrders);

router.post('/', verifyJWT, createOrder);
router.get('/:id', verifyJWT, getOrderById);
router.patch('/:id/approve', verifyJWT, verifyManager, approveOrder);
router.patch('/:id/reject', verifyJWT, verifyManager, rejectOrder);
router.patch('/:id/cancel', verifyJWT, cancelOrder);

module.exports = router;
