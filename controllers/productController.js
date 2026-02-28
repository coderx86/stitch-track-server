const { getCollections } = require('../config/db');
const { ObjectId } = require('mongodb');

// GET /products/home
const getHomeProducts = async (req, res) => {
    try {
        const { products } = getCollections();
        const list = await products.find({ showOnHome: true }).limit(6).toArray();
        res.send(list);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get home products', error: err.message });
    }
};

// GET /products/stats (admin)
const getProductStats = async (req, res) => {
    try {
        const { products } = getCollections();
        const total = await products.countDocuments();
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
        const todayCount = await products.countDocuments({ createdAt: { $gte: today } });
        const weekCount = await products.countDocuments({ createdAt: { $gte: weekAgo } });
        const monthCount = await products.countDocuments({ createdAt: { $gte: monthAgo } });
        const categories = await products.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]).toArray();
        res.send({ total, todayCount, weekCount, monthCount, categories });
    } catch (err) {
        res.status(500).send({ message: 'Failed to get stats', error: err.message });
    }
};

// GET /products/admin/all (admin)
const getAdminProducts = async (req, res) => {
    try {
        const { products } = getCollections();
        const { search, category } = req.query;
        const query = {};
        if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
        if (category) query.category = category;
        const list = await products.find(query).toArray();
        res.send(list);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get products', error: err.message });
    }
};

// GET /products/manager/my-products (manager)
const getManagerProducts = async (req, res) => {
    try {
        const { products } = getCollections();
        const list = await products.find({ createdBy: req.decoded_email }).toArray();
        res.send(list);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get products', error: err.message });
    }
};

// GET /products (public — paginated)
const getAllProducts = async (req, res) => {
    try {
        const { products } = getCollections();
        const { search, category, page = 1, limit = 12 } = req.query;
        const query = {};
        if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
        if (category) query.category = category;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const list = await products.find(query).skip(skip).limit(parseInt(limit)).toArray();
        const total = await products.countDocuments(query);
        res.send({ products: list, total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) });
    } catch (err) {
        res.status(500).send({ message: 'Failed to get products', error: err.message });
    }
};

// GET /products/:id (public)
const getProductById = async (req, res) => {
    try {
        const { products } = getCollections();
        const product = await products.findOne({ _id: new ObjectId(req.params.id) });
        if (!product) return res.status(404).send({ message: 'Product not found' });
        res.send(product);
    } catch (err) {
        res.status(500).send({ message: 'Failed to get product', error: err.message });
    }
};

// POST /products (manager)
const createProduct = async (req, res) => {
    try {
        const { products } = getCollections();
        const d = req.body;
        const product = {
            title: d.title,
            description: d.description,
            category: d.category,
            price: parseFloat(d.price),
            quantity: parseInt(d.quantity),
            moq: parseInt(d.moq) || 1,
            images: d.images || [],
            demoVideo: d.demoVideo || '',
            paymentOption: d.paymentOption || 'cod',
            showOnHome: d.showOnHome || false,
            createdBy: req.decoded_email,
            createdAt: new Date()
        };
        const result = await products.insertOne(product);
        res.status(201).send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to create product', error: err.message });
    }
};

// PUT /products/:id (manager)
const updateProduct = async (req, res) => {
    try {
        const { products } = getCollections();
        const { _id, ...data } = req.body;
        if (data.price) data.price = parseFloat(data.price);
        if (data.quantity) data.quantity = parseInt(data.quantity);
        if (data.moq) data.moq = parseInt(data.moq);
        const result = await products.updateOne({ _id: new ObjectId(req.params.id) }, { $set: data });
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to update product', error: err.message });
    }
};

// DELETE /products/manager/:id (manager)
const deleteManagerProduct = async (req, res) => {
    try {
        const { products } = getCollections();
        const result = await products.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to delete product', error: err.message });
    }
};

// PATCH /products/:id/toggle-home (admin)
const toggleShowOnHome = async (req, res) => {
    try {
        const { products } = getCollections();
        const result = await products.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { showOnHome: req.body.showOnHome } }
        );
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to toggle', error: err.message });
    }
};

// PUT /products/admin/:id (admin)
const updateAdminProduct = async (req, res) => {
    try {
        const { products } = getCollections();
        const { _id, ...data } = req.body;
        if (data.price) data.price = parseFloat(data.price);
        if (data.quantity) data.quantity = parseInt(data.quantity);
        if (data.moq) data.moq = parseInt(data.moq);
        const result = await products.updateOne({ _id: new ObjectId(req.params.id) }, { $set: data });
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to update product', error: err.message });
    }
};

// DELETE /products/admin/:id (admin)
const deleteAdminProduct = async (req, res) => {
    try {
        const { products } = getCollections();
        const result = await products.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (err) {
        res.status(500).send({ message: 'Failed to delete product', error: err.message });
    }
};

module.exports = {
    getHomeProducts, getProductStats, getAdminProducts, getManagerProducts,
    getAllProducts, getProductById, createProduct, updateProduct,
    deleteManagerProduct, toggleShowOnHome, updateAdminProduct, deleteAdminProduct
};
