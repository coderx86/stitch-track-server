const { getCollections } = require('../config/db');
const { ObjectId } = require('mongodb');

// GET /orders/stats (admin)
const getOrderStats = async (req, res) => {
    try {
        const { orders } = getCollections();
        const total = await orders.countDocuments();
        const pending = await orders.countDocuments({ status: 'pending' });
        const approved = await orders.countDocuments({ status: 'approved' });
        const rejected = await orders.countDocuments({ status: 'rejected' });
        const cancelled = await orders.countDocuments({ status: 'cancelled' });
        const completed = await orders.countDocuments({ status: 'completed' });
        const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const thisMonth = await orders.countDocuments({ orderedAt: { $gte: monthAgo } });
        res.send({ total, pending, approved, rejected, cancelled, completed, thisMonth });
    } catch (err) {
        res.status(500).send({ message: 'Failed to get stats', error: err.message });
    }
};

// GET /orders/all (admin)
const getAllOrders = async (req, res) => {
    try {
        const { orders } = getCollections();
        const { status, search } = req.query;
        const query = {};
        if (status) query.status = status;
        if (search) query.$or = [
            { productTitle: { $regex: search, $options: 'i' } },
            { userEmail: { $regex: search, $options: 'i' } }
        ];
        const list = await orders.find(query).sort({ orderedAt: -1 }).toArray();
        res.send(list);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get orders', error: err.message });
    }
};

// GET /orders/pending (manager)
const getPendingOrders = async (req, res) => {
    try {
        const { orders } = getCollections();
        const list = await orders.find({ status: 'pending' }).sort({ orderedAt: -1 }).toArray();
        res.send(list);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get pending orders', error: err.message });
    }
};

// GET /orders/approved (manager)
const getApprovedOrders = async (req, res) => {
    try {
        const { orders } = getCollections();
        const list = await orders.find({ status: 'approved' }).sort({ approvedAt: -1 }).toArray();
        res.send(list);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get approved orders', error: err.message });
    }
};

// GET /orders/manager/all (manager)
const getManagerOrders = async (req, res) => {
    try {
        const { orders } = getCollections();
        const { status, search } = req.query;
        const query = {};
        if (status) query.status = status;
        if (search) query.$or = [
            { productTitle: { $regex: search, $options: 'i' } },
            { userEmail: { $regex: search, $options: 'i' } }
        ];
        const list = await orders.find(query).sort({ orderedAt: -1 }).toArray();
        res.send(list);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get orders', error: err.message });
    }
};

// GET /orders/my-orders (buyer)
const getMyOrders = async (req, res) => {
    try {
        const { orders } = getCollections();
        const list = await orders.find({ userEmail: req.decoded_email }).sort({ orderedAt: -1 }).toArray();
        res.send(list);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get orders', error: err.message });
    }
};

// POST /orders (buyer)
const createOrder = async (req, res) => {
    try {
        const { orders, products, users } = getCollections();
        const user = await users.findOne({ email: req.decoded_email });
        if (user?.status === 'suspended') {
            return res.status(403).send({ message: 'Your account is suspended. Cannot place new orders.' });
        }
        const d = req.body;
        const product = await products.findOne({ _id: new ObjectId(d.productId) });
        if (!product) return res.status(404).send({ message: 'Product not found' });
        if (d.quantity > product.quantity) return res.status(400).send({ message: 'Order quantity exceeds available quantity' });
        if (d.quantity < product.moq) return res.status(400).send({ message: `Minimum order quantity is ${product.moq}` });

        const order = {
            userId: user?._id?.toString(),
            userEmail: req.decoded_email,
            productId: d.productId,
            productTitle: d.productTitle,
            quantity: parseInt(d.quantity),
            totalPrice: parseFloat(d.totalPrice),
            firstName: d.firstName,
            lastName: d.lastName,
            contactNumber: d.contactNumber,
            deliveryAddress: d.deliveryAddress,
            notes: d.notes || '',
            status: 'pending',
            paymentMethod: d.paymentMethod || 'cod',
            paymentStatus: d.paymentMethod === 'payfirst' ? 'unpaid' : 'cod',
            orderedAt: new Date(),
            approvedAt: null
        };
        const result = await orders.insertOne(order);
        await products.updateOne({ _id: new ObjectId(d.productId) }, { $inc: { quantity: -parseInt(d.quantity) } });
        res.status(201).send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to create order', error: err.message });
    }
};

// GET /orders/:id
const getOrderById = async (req, res) => {
    try {
        const { orders, trackings } = getCollections();
        const order = await orders.findOne({ _id: new ObjectId(req.params.id) });
        if (!order) return res.status(404).send({ message: 'Order not found' });
        const tracking = await trackings.findOne({ orderId: req.params.id });
        res.send({ ...order, tracking: tracking?.updates || [] });
    } catch (err) {
        res.status(500).send({ message: 'Failed to get order', error: err.message });
    }
};

// PATCH /orders/:id/approve (manager)
const approveOrder = async (req, res) => {
    try {
        const { orders, users } = getCollections();
        const user = await users.findOne({ email: req.decoded_email });
        if (user?.status === 'suspended') return res.status(403).send({ message: 'account suspended' });
        const result = await orders.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status: 'approved', approvedAt: new Date() } }
        );
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to approve order', error: err.message });
    }
};

// PATCH /orders/:id/reject (manager)
const rejectOrder = async (req, res) => {
    try {
        const { orders, users } = getCollections();
        const user = await users.findOne({ email: req.decoded_email });
        if (user?.status === 'suspended') return res.status(403).send({ message: 'account suspended' });
        const result = await orders.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: 'rejected' } });
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to reject order', error: err.message });
    }
};

// PATCH /orders/:id/cancel (buyer)
const cancelOrder = async (req, res) => {
    try {
        const { orders, products } = getCollections();
        const order = await orders.findOne({ _id: new ObjectId(req.params.id) });
        if (!order) return res.status(404).send({ message: 'Order not found' });
        if (order.status !== 'pending') return res.status(400).send({ message: 'Only pending orders can be cancelled' });
        if (order.userEmail !== req.decoded_email) return res.status(403).send({ message: 'You can only cancel your own orders' });
        const result = await orders.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status: 'cancelled' } });
        await products.updateOne({ _id: new ObjectId(order.productId) }, { $inc: { quantity: order.quantity } });
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to cancel order', error: err.message });
    }
};

module.exports = {
    getOrderStats, getAllOrders, getPendingOrders, getApprovedOrders,
    getManagerOrders, getMyOrders, createOrder, getOrderById,
    approveOrder, rejectOrder, cancelOrder
};
