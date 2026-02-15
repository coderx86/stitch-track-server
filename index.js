const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(cors());

// ─── Firebase Admin Init ─────────────────────────────────────
const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// ─── Auth Middleware ─────────────────────────────────────────
const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
    try {
        const idToken = token.split(' ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.decoded_email = decodedToken.email;

        // Check suspension status
        const user = await usersCollection.findOne({ email: decodedToken.email });
        if (user?.status === 'suspended') {
            return res.status(403).send({
                message: 'account suspended',
                reason: user.suspendReason || 'Contact admin for details',
                feedback: user.suspendFeedback
            });
        }

        next();
    } catch (err) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
};

const verifyAdmin = async (req, res, next) => {
    const email = req.decoded_email;
    const user = await usersCollection.findOne({ email });
    if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
    }
    next();
};

const verifyManager = async (req, res, next) => {
    const email = req.decoded_email;
    const user = await usersCollection.findOne({ email });
    if (!user || user.role !== 'manager') {
        return res.status(403).send({ message: 'forbidden access' });
    }
    if (user.status === 'suspended') {
        return res.status(403).send({ message: 'account suspended', suspended: true });
    }
    next();
};

const verifyBuyer = async (req, res, next) => {
    const email = req.decoded_email;
    const user = await usersCollection.findOne({ email });
    if (!user || user.role !== 'buyer') {
        return res.status(403).send({ message: 'forbidden access' });
    }
    if (user.status === 'suspended') {
        return res.status(403).send({ message: 'account suspended', suspended: true });
    }
    next();
};

// ─── MongoDB Connection ──────────────────────────────────────
const uri = process.env.DB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Collection references (populated on connect)
let usersCollection, productsCollection, ordersCollection, trackingsCollection, paymentsCollection;

// Root endpoint
app.get('/', (req, res) => {
    res.send('StitchTrack server is running!');
});

async function run() {
    try {
        await client.connect();
        const db = client.db('garments_tracker_db');

        usersCollection = db.collection('users');
        productsCollection = db.collection('products');
        ordersCollection = db.collection('orders');
        trackingsCollection = db.collection('trackings');
        paymentsCollection = db.collection('payments');

        console.log('Connected to MongoDB successfully');

        // ═══════════════════════════════════════════════════════════
        //  USER ROUTES
        // ═══════════════════════════════════════════════════════════

        // Save user on login/register (public)
        app.post('/users', async (req, res) => {
            try {
                const userData = req.body;
                const existing = await usersCollection.findOne({ email: userData.email });
                if (existing) {
                    return res.send({ message: 'user already exists', user: existing });
                }
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
                const result = await usersCollection.insertOne(user);
                res.status(201).send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to save user', error: error.message });
            }
        });

        // Get user role and status (needs auth)
        app.get('/users/:email/role', verifyFBToken, async (req, res) => {
            try {
                const email = req.params.email;
                const user = await usersCollection.findOne({ email });
                res.send({ role: user?.role || 'buyer', status: user?.status || 'active' });
            } catch (error) {
                res.status(500).send({ message: 'Failed to get role', error: error.message });
            }
        });

        // Get user profile (needs auth)
        app.get('/users/:email/profile', verifyFBToken, async (req, res) => {
            try {
                const email = req.params.email;
                const user = await usersCollection.findOne({ email });
                if (!user) {
                    return res.status(404).send({ message: 'User not found' });
                }
                res.send(user);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get profile', error: error.message });
            }
        });

        // Get user stats (admin only) — must be before /users/:id routes
        app.get('/users/stats', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const total = await usersCollection.countDocuments();
                const buyers = await usersCollection.countDocuments({ role: 'buyer' });
                const managers = await usersCollection.countDocuments({ role: 'manager' });
                const admins = await usersCollection.countDocuments({ role: 'admin' });
                const now = new Date();
                const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
                const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
                const newThisWeek = await usersCollection.countDocuments({ createdAt: { $gte: weekAgo } });
                const newThisMonth = await usersCollection.countDocuments({ createdAt: { $gte: monthAgo } });
                res.send({ total, buyers, managers, admins, newThisWeek, newThisMonth });
            } catch (error) {
                res.status(500).send({ message: 'Failed to get stats', error: error.message });
            }
        });

        // Get all users (admin only)
        app.get('/users', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { search, role, status, page = 1, limit = 10 } = req.query;
                const query = {};
                if (search) {
                    query.$or = [
                        { name: { $regex: search, $options: 'i' } },
                        { email: { $regex: search, $options: 'i' } }
                    ];
                }
                if (role) query.role = role;
                if (status) query.status = status;
                const skip = (parseInt(page) - 1) * parseInt(limit);
                const users = await usersCollection.find(query).skip(skip).limit(parseInt(limit)).toArray();
                const total = await usersCollection.countDocuments(query);
                res.send({ users, total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) });
            } catch (error) {
                res.status(500).send({ message: 'Failed to get users', error: error.message });
            }
        });

        // Update user role (admin only)
        app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { id } = req.params;
                const { role } = req.body;
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to update role', error: error.message });
            }
        });

        // Update user status (admin only — approve/suspend)
        app.patch('/users/:id/status', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { id } = req.params;
                const { status, suspendReason, suspendFeedback } = req.body;
                const updateData = { status };
                if (status === 'suspended') {
                    updateData.suspendReason = suspendReason || '';
                    updateData.suspendFeedback = suspendFeedback || '';
                }
                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to update status', error: error.message });
            }
        });

        // ═══════════════════════════════════════════════════════════
        //  PRODUCT ROUTES
        // ═══════════════════════════════════════════════════════════

        // Get home products (public, limited to 6)
        app.get('/products/home', async (req, res) => {
            try {
                const products = await productsCollection.find({ showOnHome: true }).limit(6).toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get home products', error: error.message });
            }
        });

        // Get product stats (admin) — place before :id
        app.get('/products/stats', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const total = await productsCollection.countDocuments();
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
                const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
                const todayCount = await productsCollection.countDocuments({ createdAt: { $gte: today } });
                const weekCount = await productsCollection.countDocuments({ createdAt: { $gte: weekAgo } });
                const monthCount = await productsCollection.countDocuments({ createdAt: { $gte: monthAgo } });
                const categories = await productsCollection.aggregate([
                    { $group: { _id: '$category', count: { $sum: 1 } } }
                ]).toArray();
                res.send({ total, todayCount, weekCount, monthCount, categories });
            } catch (error) {
                res.status(500).send({ message: 'Failed to get stats', error: error.message });
            }
        });

        // Get admin products (all products in system)
        app.get('/products/admin/all', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { search, category } = req.query;
                const query = {};
                if (search) {
                    query.$or = [
                        { title: { $regex: search, $options: 'i' } },
                        { description: { $regex: search, $options: 'i' } }
                    ];
                }
                if (category) query.category = category;
                const products = await productsCollection.find(query).toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get products', error: error.message });
            }
        });

        // Get manager's own products
        app.get('/products/manager/my-products', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const email = req.decoded_email;
                const products = await productsCollection.find({ createdBy: email }).toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get products', error: error.message });
            }
        });

        // Get all products with pagination (public)
        app.get('/products', async (req, res) => {
            try {
                const { search, category, page = 1, limit = 12 } = req.query;
                const query = {};
                if (search) {
                    query.$or = [
                        { title: { $regex: search, $options: 'i' } },
                        { description: { $regex: search, $options: 'i' } }
                    ];
                }
                if (category) query.category = category;
                const skip = (parseInt(page) - 1) * parseInt(limit);
                const products = await productsCollection.find(query).skip(skip).limit(parseInt(limit)).toArray();
                const total = await productsCollection.countDocuments(query);
                res.send({ products, total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) });
            } catch (error) {
                res.status(500).send({ message: 'Failed to get products', error: error.message });
            }
        });

        // Get single product (public)
        app.get('/products/:id', async (req, res) => {
            try {
                const product = await productsCollection.findOne({ _id: new ObjectId(req.params.id) });
                if (!product) {
                    return res.status(404).send({ message: 'Product not found' });
                }
                res.send(product);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get product', error: error.message });
            }
        });

        // Create product (manager)
        app.post('/products', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const productData = req.body;
                const product = {
                    title: productData.title,
                    description: productData.description,
                    category: productData.category,
                    price: parseFloat(productData.price),
                    quantity: parseInt(productData.quantity),
                    moq: parseInt(productData.moq) || 1,
                    images: productData.images || [],
                    demoVideo: productData.demoVideo || '',
                    paymentOption: productData.paymentOption || 'cod',
                    showOnHome: productData.showOnHome || false,
                    createdBy: req.decoded_email,
                    createdAt: new Date()
                };
                const result = await productsCollection.insertOne(product);
                res.status(201).send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to create product', error: error.message });
            }
        });

        // Update product (manager)
        app.put('/products/:id', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const { _id, ...data } = req.body;
                if (data.price) data.price = parseFloat(data.price);
                if (data.quantity) data.quantity = parseInt(data.quantity);
                if (data.moq) data.moq = parseInt(data.moq);
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: data }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to update product', error: error.message });
            }
        });

        // Delete product (manager)
        app.delete('/products/manager/:id', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const result = await productsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to delete product', error: error.message });
            }
        });

        // Toggle show on home (admin)
        app.patch('/products/:id/toggle-home', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { showOnHome } = req.body;
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: { showOnHome } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to toggle show on home', error: error.message });
            }
        });

        // Update product (admin)
        app.put('/products/admin/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { _id, ...data } = req.body;
                if (data.price) data.price = parseFloat(data.price);
                if (data.quantity) data.quantity = parseInt(data.quantity);
                if (data.moq) data.moq = parseInt(data.moq);
                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: data }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to update product', error: error.message });
            }
        });

        // Delete product (admin)
        app.delete('/products/admin/:id', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const result = await productsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to delete product', error: error.message });
            }
        });

        // ═══════════════════════════════════════════════════════════
        //  ORDER ROUTES
        // ═══════════════════════════════════════════════════════════

        // Get order stats (admin) — place before :id
        app.get('/orders/stats', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const total = await ordersCollection.countDocuments();
                const pending = await ordersCollection.countDocuments({ status: 'pending' });
                const approved = await ordersCollection.countDocuments({ status: 'approved' });
                const rejected = await ordersCollection.countDocuments({ status: 'rejected' });
                const cancelled = await ordersCollection.countDocuments({ status: 'cancelled' });
                const completed = await ordersCollection.countDocuments({ status: 'completed' });
                const now = new Date();
                const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
                const thisMonth = await ordersCollection.countDocuments({ orderedAt: { $gte: monthAgo } });
                res.send({ total, pending, approved, rejected, cancelled, completed, thisMonth });
            } catch (error) {
                res.status(500).send({ message: 'Failed to get stats', error: error.message });
            }
        });

        // Get all orders (admin)
        app.get('/orders/all', verifyFBToken, verifyAdmin, async (req, res) => {
            try {
                const { status, search } = req.query;
                const query = {};
                if (status) query.status = status;
                if (search) {
                    query.$or = [
                        { productTitle: { $regex: search, $options: 'i' } },
                        { userEmail: { $regex: search, $options: 'i' } }
                    ];
                }
                const orders = await ordersCollection.find(query).sort({ orderedAt: -1 }).toArray();
                res.send(orders);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get orders', error: error.message });
            }
        });

        // Get pending orders (manager)
        app.get('/orders/pending', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const orders = await ordersCollection.find({ status: 'pending' }).sort({ orderedAt: -1 }).toArray();
                res.send(orders);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get pending orders', error: error.message });
            }
        });

        // Get approved orders (manager)
        app.get('/orders/approved', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const orders = await ordersCollection.find({ status: 'approved' }).sort({ approvedAt: -1 }).toArray();
                res.send(orders);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get approved orders', error: error.message });
            }
        });

        // Get all orders for manager (log)
        app.get('/orders/manager/all', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const { status, search } = req.query;
                const query = {};
                if (status) query.status = status;
                if (search) {
                    query.$or = [
                        { productTitle: { $regex: search, $options: 'i' } },
                        { userEmail: { $regex: search, $options: 'i' } }
                    ];
                }
                const orders = await ordersCollection.find(query).sort({ orderedAt: -1 }).toArray();
                res.send(orders);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get orders', error: error.message });
            }
        });

        // Get user's orders (buyer)
        app.get('/orders/my-orders', verifyFBToken, async (req, res) => {
            try {
                const orders = await ordersCollection.find({ userEmail: req.decoded_email }).sort({ orderedAt: -1 }).toArray();
                res.send(orders);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get orders', error: error.message });
            }
        });

        // Create order (buyer)
        app.post('/orders', verifyFBToken, async (req, res) => {
            try {
                const user = await usersCollection.findOne({ email: req.decoded_email });
                if (user && user.status === 'suspended') {
                    return res.status(403).send({ message: 'Your account is suspended. Cannot place new orders.' });
                }

                const orderData = req.body;
                const product = await productsCollection.findOne({ _id: new ObjectId(orderData.productId) });
                if (!product) {
                    return res.status(404).send({ message: 'Product not found' });
                }
                if (orderData.quantity > product.quantity) {
                    return res.status(400).send({ message: 'Order quantity exceeds available quantity' });
                }
                if (orderData.quantity < product.moq) {
                    return res.status(400).send({ message: `Minimum order quantity is ${product.moq}` });
                }

                const order = {
                    userId: user?._id?.toString(),
                    userEmail: req.decoded_email,
                    productId: orderData.productId,
                    productTitle: orderData.productTitle,
                    quantity: parseInt(orderData.quantity),
                    totalPrice: parseFloat(orderData.totalPrice),
                    firstName: orderData.firstName,
                    lastName: orderData.lastName,
                    contactNumber: orderData.contactNumber,
                    deliveryAddress: orderData.deliveryAddress,
                    notes: orderData.notes || '',
                    status: 'pending',
                    paymentMethod: orderData.paymentMethod || 'cod',
                    paymentStatus: orderData.paymentMethod === 'payfirst' ? 'unpaid' : 'cod',
                    orderedAt: new Date(),
                    approvedAt: null
                };

                const result = await ordersCollection.insertOne(order);

                // Decrement product quantity
                await productsCollection.updateOne(
                    { _id: new ObjectId(orderData.productId) },
                    { $inc: { quantity: -parseInt(orderData.quantity) } }
                );

                res.status(201).send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to create order', error: error.message });
            }
        });

        // Get single order details
        app.get('/orders/:id', verifyFBToken, async (req, res) => {
            try {
                const order = await ordersCollection.findOne({ _id: new ObjectId(req.params.id) });
                if (!order) {
                    return res.status(404).send({ message: 'Order not found' });
                }
                const tracking = await trackingsCollection.findOne({ orderId: req.params.id });
                res.send({ ...order, tracking: tracking?.updates || [] });
            } catch (error) {
                res.status(500).send({ message: 'Failed to get order', error: error.message });
            }
        });

        // Approve order (manager)
        app.patch('/orders/:id/approve', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const user = await usersCollection.findOne({ email: req.decoded_email });
                if (user && user.status === 'suspended') {
                    return res.status(403).send({ message: 'Your account is suspended. Cannot approve orders.' });
                }
                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: { status: 'approved', approvedAt: new Date() } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to approve order', error: error.message });
            }
        });

        // Reject order (manager)
        app.patch('/orders/:id/reject', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const user = await usersCollection.findOne({ email: req.decoded_email });
                if (user && user.status === 'suspended') {
                    return res.status(403).send({ message: 'Your account is suspended. Cannot reject orders.' });
                }
                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: { status: 'rejected' } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to reject order', error: error.message });
            }
        });

        // Cancel order (buyer — only pending)
        app.patch('/orders/:id/cancel', verifyFBToken, async (req, res) => {
            try {
                const order = await ordersCollection.findOne({ _id: new ObjectId(req.params.id) });
                if (!order) {
                    return res.status(404).send({ message: 'Order not found' });
                }
                if (order.status !== 'pending') {
                    return res.status(400).send({ message: 'Only pending orders can be cancelled' });
                }
                if (order.userEmail !== req.decoded_email) {
                    return res.status(403).send({ message: 'You can only cancel your own orders' });
                }
                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(req.params.id) },
                    { $set: { status: 'cancelled' } }
                );
                // Restore product quantity
                await productsCollection.updateOne(
                    { _id: new ObjectId(order.productId) },
                    { $inc: { quantity: order.quantity } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to cancel order', error: error.message });
            }
        });

        // ═══════════════════════════════════════════════════════════
        //  TRACKING ROUTES
        // ═══════════════════════════════════════════════════════════

        // Get tracking for an order (authenticated)
        app.get('/trackings/:orderId', verifyFBToken, async (req, res) => {
            try {
                const tracking = await trackingsCollection.findOne({ orderId: req.params.orderId });
                if (!tracking) {
                    return res.send({ orderId: req.params.orderId, updates: [] });
                }
                res.send(tracking);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get tracking', error: error.message });
            }
        });

        // Add tracking update (manager only)
        app.post('/trackings/:orderId', verifyFBToken, verifyManager, async (req, res) => {
            try {
                const orderId = req.params.orderId;
                const updateData = req.body;
                const update = {
                    step: updateData.step,
                    location: updateData.location || '',
                    note: updateData.note || '',
                    dateTime: new Date(),
                    status: updateData.status
                };

                const existing = await trackingsCollection.findOne({ orderId });
                if (!existing) {
                    await trackingsCollection.insertOne({
                        orderId,
                        updates: [],
                        createdAt: new Date()
                    });
                }

                const result = await trackingsCollection.updateOne(
                    { orderId },
                    { $push: { updates: update } }
                );

                // If status is Delivered, update order status to completed
                if (updateData.status && updateData.status.toLowerCase() === 'delivered') {
                    await ordersCollection.updateOne(
                        { _id: new ObjectId(orderId) },
                        { $set: { status: 'completed' } }
                    );
                }
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to add tracking update', error: error.message });
            }
        });

        // ═══════════════════════════════════════════════════════════
        //  PAYMENT ROUTES
        // ═══════════════════════════════════════════════════════════

        // Create Checkout Session (Stripe Redirect)
        app.post('/create-checkout-session', verifyFBToken, async (req, res) => {
            try {
                const { orderId } = req.body;
                const order = await ordersCollection.findOne({ _id: new ObjectId(orderId) });
                if (!order) {
                    return res.status(404).send({ message: 'Order not found' });
                }

                const amountInCents = Math.round(order.totalPrice * 100);
                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                product_data: {
                                    name: `Order: ${order.productTitle}`,
                                },
                                unit_amount: amountInCents,
                            },
                            quantity: 1,
                        },
                    ],
                    mode: 'payment',
                    metadata: {
                        orderId: order._id.toString(),
                        userEmail: order.userEmail
                    },
                    customer_email: order.userEmail,
                    success_url: `${process.env.SITE_DOMAIN || 'http://localhost:5173'}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.SITE_DOMAIN || 'http://localhost:5173'}/dashboard/payment-fail`,
                });

                res.send({ url: session.url });
            } catch (error) {
                res.status(500).send({ message: 'Failed to create checkout session', error: error.message });
            }
        });

        // Handle Payment Success (Verify Session)
        app.patch('/payment-success', verifyFBToken, async (req, res) => {
            try {
                const { session_id } = req.query;
                const session = await stripe.checkout.sessions.retrieve(session_id);

                if (session.payment_status === 'paid') {
                    const orderId = session.metadata.orderId;
                    const transactionId = session.payment_intent;

                    // Update order status
                    const updateResult = await ordersCollection.updateOne(
                        { _id: new ObjectId(orderId) },
                        {
                            $set: {
                                paymentStatus: 'paid',
                                transactionId: transactionId,
                                status: 'approved'
                            }
                        }
                    );

                    // Create payment record if not exists
                    const existingPayment = await paymentsCollection.findOne({ transactionId });
                    if (!existingPayment) {
                        const payment = {
                            orderId,
                            email: session.customer_email,
                            amount: session.amount_total / 100,
                            transactionId,
                            status: 'completed',
                            createdAt: new Date()
                        };
                        await paymentsCollection.insertOne(payment);
                    }

                    return res.send({ success: true, transactionId });
                }

                res.send({ success: false });
            } catch (error) {
                res.status(500).send({ message: 'Error processing payment success', error: error.message });
            }
        });

        // Get payment history
        app.get('/payments/history', verifyFBToken, async (req, res) => {
            try {
                const payments = await paymentsCollection.find({ email: req.decoded_email }).sort({ createdAt: -1 }).toArray();
                res.send(payments);
            } catch (error) {
                res.status(500).send({ message: 'Failed to get payment history', error: error.message });
            }
        });

        app.listen(port, () => {
            console.log(`StitchTrack server listening on port ${port}`);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

run();
