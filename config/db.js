const { MongoClient, ServerApiVersion } = require('mongodb');

const client = new MongoClient(process.env.DB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const collections = {};

const connectDB = async () => {
    await client.connect();
    const db = client.db('garments_tracker_db');

    collections.users = db.collection('users');
    collections.products = db.collection('products');
    collections.orders = db.collection('orders');
    collections.trackings = db.collection('trackings');
    collections.payments = db.collection('payments');

    console.log('✅ Connected to MongoDB');
};

const getCollections = () => collections;

module.exports = { connectDB, getCollections };
