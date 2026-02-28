const { getCollections } = require('../config/db');
const { ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const SITE_URL = process.env.SITE_DOMAIN || 'http://localhost:5173';

// POST /create-checkout-session
const createCheckoutSession = async (req, res) => {
    try {
        const { orders } = getCollections();
        const order = await orders.findOne({ _id: new ObjectId(req.body.orderId) });
        if (!order) return res.status(404).send({ message: 'Order not found' });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: `Order: ${order.productTitle}` },
                    unit_amount: Math.round(order.totalPrice * 100)
                },
                quantity: 1
            }],
            mode: 'payment',
            metadata: { orderId: order._id.toString(), userEmail: order.userEmail },
            customer_email: order.userEmail,
            success_url: `${SITE_URL}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${SITE_URL}/dashboard/payment-fail`
        });
        res.send({ url: session.url });
    } catch (err) {
        res.status(500).send({ message: 'Failed to create checkout session', error: err.message });
    }
};

// PATCH /payment-success
const handlePaymentSuccess = async (req, res) => {
    try {
        const { orders, payments } = getCollections();
        const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
        if (session.payment_status !== 'paid') return res.send({ success: false });

        const { orderId } = session.metadata;
        const transactionId = session.payment_intent;

        await orders.updateOne(
            { _id: new ObjectId(orderId) },
            { $set: { paymentStatus: 'paid', transactionId, status: 'approved' } }
        );

        const existing = await payments.findOne({ transactionId });
        if (!existing) {
            await payments.insertOne({
                orderId,
                email: session.customer_email,
                amount: session.amount_total / 100,
                transactionId,
                status: 'completed',
                createdAt: new Date()
            });
        }
        res.send({ success: true, transactionId });
    } catch (err) {
        res.status(500).send({ message: 'Error processing payment', error: err.message });
    }
};

// GET /payments/history
const getPaymentHistory = async (req, res) => {
    try {
        const { payments } = getCollections();
        const list = await payments.find({ email: req.decoded_email }).sort({ createdAt: -1 }).toArray();
        res.send(list);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get payment history', error: err.message });
    }
};

module.exports = { createCheckoutSession, handlePaymentSuccess, getPaymentHistory };
