const router = require('express').Router();
const verifyJWT = require('../middleware/verifyJWT');
const { createCheckoutSession, handlePaymentSuccess, getPaymentHistory } = require('../controllers/paymentController');

router.post('/create-checkout-session', verifyJWT, createCheckoutSession);
router.patch('/payment-success', verifyJWT, handlePaymentSuccess);
router.get('/payments/history', verifyJWT, getPaymentHistory);

module.exports = router;
