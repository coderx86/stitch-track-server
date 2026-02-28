const { getCollections } = require('../config/db');

// POST /users — save on register
const saveUser = async (req, res) => {
    try {
        const { users } = getCollections();
        const userData = req.body;
        const existing = await users.findOne({ email: userData.email });
        if (existing) return res.send({ message: 'user already exists', user: existing });

        const user = {
            name: userData.name,
            email: userData.email,
            photoURL: userData.photoURL || '',
            role: userData.role || 'buyer',
            status: 'pending',
            suspendReason: '',
            suspendFeedback: '',
            createdAt: new Date()
        };
        const result = await users.insertOne(user);
        res.status(201).send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to save user', error: err.message });
    }
};

// GET /users/:email/role
const getUserRole = async (req, res) => {
    try {
        const { users } = getCollections();
        const user = await users.findOne({ email: req.params.email });
        res.send({ role: user?.role || 'buyer', status: user?.status || 'active' });
    } catch (err) {
        res.status(500).send({ message: 'Failed to get role', error: err.message });
    }
};

// GET /users/:email/profile
const getUserProfile = async (req, res) => {
    try {
        const { users } = getCollections();
        const user = await users.findOne({ email: req.params.email });
        if (!user) return res.status(404).send({ message: 'User not found' });
        res.send(user);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get profile', error: err.message });
    }
};

// GET /users/stats (admin)
const getUserStats = async (req, res) => {
    try {
        const { users } = getCollections();
        const total = await users.countDocuments();
        const buyers = await users.countDocuments({ role: 'buyer' });
        const managers = await users.countDocuments({ role: 'manager' });
        const admins = await users.countDocuments({ role: 'admin' });
        const now = new Date();
        const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const newThisWeek = await users.countDocuments({ createdAt: { $gte: weekAgo } });
        const newThisMonth = await users.countDocuments({ createdAt: { $gte: monthAgo } });
        res.send({ total, buyers, managers, admins, newThisWeek, newThisMonth });
    } catch (err) {
        res.status(500).send({ message: 'Failed to get stats', error: err.message });
    }
};

// GET /users (admin — paginated)
const getAllUsers = async (req, res) => {
    try {
        const { users } = getCollections();
        const { search, role, status, page = 1, limit = 10 } = req.query;
        const query = {};
        if (search) query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
        ];
        if (role) query.role = role;
        if (status) query.status = status;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const list = await users.find(query).skip(skip).limit(parseInt(limit)).toArray();
        const total = await users.countDocuments(query);
        res.send({ users: list, total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) });
    } catch (err) {
        res.status(500).send({ message: 'Failed to get users', error: err.message });
    }
};

// PATCH /users/:id/role (admin)
const updateUserRole = async (req, res) => {
    try {
        const { users } = getCollections();
        const { ObjectId } = require('mongodb');
        const result = await users.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { role: req.body.role } }
        );
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to update role', error: err.message });
    }
};

// PATCH /users/:id/status (admin)
const updateUserStatus = async (req, res) => {
    try {
        const { users } = getCollections();
        const { ObjectId } = require('mongodb');
        const { status, suspendReason, suspendFeedback } = req.body;
        const data = { status };
        if (status === 'suspended') {
            data.suspendReason = suspendReason || '';
            data.suspendFeedback = suspendFeedback || '';
        }
        const result = await users.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: data }
        );
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to update status', error: err.message });
    }
};

module.exports = { saveUser, getUserRole, getUserProfile, getUserStats, getAllUsers, updateUserRole, updateUserStatus };
