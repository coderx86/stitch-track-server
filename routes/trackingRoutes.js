const router = require('express').Router();
const verifyJWT = require('../middleware/verifyJWT');
const verifyManager = require('../middleware/verifyManager');
const { getTracking, addTrackingUpdate } = require('../controllers/trackingController');

router.get('/:orderId', verifyJWT, getTracking);
router.post('/:orderId', verifyJWT, verifyManager, addTrackingUpdate);

module.exports = router;
