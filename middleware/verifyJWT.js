const { admin } = require('../config/firebaseAdmin');
const { getCollections } = require('../config/db');

const verifyJWT = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ message: 'unauthorized access' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded_email = decoded.email;

        const { users } = getCollections();
        const user = await users.findOne({ email: decoded.email });
        if (user?.status === 'suspended') {
            return res.status(403).send({
                message: 'account suspended',
                reason: user.suspendReason || 'Contact admin for details',
                feedback: user.suspendFeedback
            });
        }
        next();
    } catch {
        return res.status(401).send({ message: 'unauthorized access' });
    }
};

module.exports = verifyJWT;
