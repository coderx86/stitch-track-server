const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { connectDB } = require('./config/db');
const { initFirebaseAdmin } = require('./config/firebaseAdmin');
const errorHandler = require('./middleware/errorHandler');

const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');

const app = express();
const port = process.env.PORT || 3000;

// ─── Global Middleware ────────────────────────────────────────
app.use(express.json());
app.use(cors({
    origin: [
        'http://localhost:5173',
        process.env.SITE_DOMAIN || 'http://localhost:5173'
    ],
    credentials: true
}));

// ─── Health Check ─────────────────────────────────────────────
app.get('/', (req, res) => res.send('🚀 StitchTrack server is running!'));

// ─── Routes ──────────────────────────────────────────────────
app.use('/users', userRoutes);
app.use('/products', productRoutes);

// ─── Centralized Error Handler ────────────────────────────────
app.use(errorHandler);

// ─── Bootstrap ───────────────────────────────────────────────
(async () => {
    try {
        initFirebaseAdmin();
        await connectDB();
        app.listen(port, () =>
            console.log(`🚀 StitchTrack server listening on port ${port}`)
        );
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
})();
