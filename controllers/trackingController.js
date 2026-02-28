const { getCollections } = require('../config/db');
const { ObjectId } = require('mongodb');

// GET /trackings/:orderId
const getTracking = async (req, res) => {
    try {
        const { trackings } = getCollections();
        const tracking = await trackings.findOne({ orderId: req.params.orderId });
        res.send(tracking || { orderId: req.params.orderId, updates: [] });
    } catch (err) {
        res.status(500).send({ message: 'Failed to get tracking', error: err.message });
    }
};

// POST /trackings/:orderId (manager)
const addTrackingUpdate = async (req, res) => {
    try {
        const { trackings, orders } = getCollections();
        const orderId = req.params.orderId;
        const update = {
            step: req.body.step,
            location: req.body.location || '',
            note: req.body.note || '',
            dateTime: new Date(),
            status: req.body.status
        };

        const existing = await trackings.findOne({ orderId });
        if (!existing) {
            await trackings.insertOne({ orderId, updates: [], createdAt: new Date() });
        }
        const result = await trackings.updateOne({ orderId }, { $push: { updates: update } });

        if (req.body.status?.toLowerCase() === 'delivered') {
            await orders.updateOne({ _id: new ObjectId(orderId) }, { $set: { status: 'completed' } });
        }
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to add tracking update', error: err.message });
    }
};

module.exports = { getTracking, addTrackingUpdate };
