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

    } finally {
        // Keep connection open
    }
}
run().catch(console.dir);

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
