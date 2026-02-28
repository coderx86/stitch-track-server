const { getCollections } = require('../config/db');

const verifyManager = async (req, res, next) => {
    const { users } = getCollections();
    const user = await users.findOne({ email: req.decoded_email });
    if (!user || user.role !== 'manager') {
        return res.status(403).send({ message: 'forbidden access' });
    }
    if (user.status === 'suspended') {
        return res.status(403).send({ message: 'account suspended', suspended: true });
    }
    next();
};

module.exports = verifyManager;
