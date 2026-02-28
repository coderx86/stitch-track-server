const admin = require('firebase-admin');

let initialized = false;

const initFirebaseAdmin = () => {
    if (initialized) return admin;
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    let serviceAccount;
    try {
        serviceAccount = JSON.parse(raw);
    } catch {
        serviceAccount = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    initialized = true;
    console.log('✅ Firebase Admin initialized');
    return admin;
};

module.exports = { initFirebaseAdmin, admin };
