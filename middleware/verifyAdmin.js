const { getCollections } = require('../config/db');

const verifyAdmin = async (req, res, next) => {
    const { users } = getCollections();
    const user = await users.findOne({ email: req.decoded_email });
    if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
    }
    next();
};

module.exports = verifyAdmin;
