const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors());

// Firebase Admin Init
const serviceAccount = require("./garments-server-firebase-adminsdk-key.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// Auth Middleware
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

// MongoDB Connection
const uri = process.env.DB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// Collection references
let usersCollection, productsCollection, ordersCollection, trackingsCollection, paymentsCollection;

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
                    images: productData.images || [],
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

        // ═══════════════════════════════════════════════════════════
        //  ORDER ROUTES
        // ═══════════════════════════════════════════════════════════

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
                if (orderData.quantity < (product.moq || 1)) {
                    return res.status(400).send({ message: `Minimum order quantity is ${product.moq || 1}` });
                }

                const order = {
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
                    orderedAt: new Date()
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

    } finally {
        // Keep connection open
    }
}
run().catch(console.dir);

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
