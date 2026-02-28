const router = require('express').Router();
const verifyJWT = require('../middleware/verifyJWT');
const verifyAdmin = require('../middleware/verifyAdmin');
const verifyManager = require('../middleware/verifyManager');
const {
    getHomeProducts, getProductStats, getAdminProducts, getManagerProducts,
    getAllProducts, getProductById, createProduct, updateProduct,
    deleteManagerProduct, toggleShowOnHome, updateAdminProduct, deleteAdminProduct
} = require('../controllers/productController');

// Specific routes first, dynamic :id last
router.get('/home', getHomeProducts);
router.get('/stats', verifyJWT, verifyAdmin, getProductStats);
router.get('/admin/all', verifyJWT, verifyAdmin, getAdminProducts);
router.get('/manager/my-products', verifyJWT, verifyManager, getManagerProducts);
router.get('/', getAllProducts);
router.get('/:id', getProductById);

router.post('/', verifyJWT, verifyManager, createProduct);
router.put('/admin/:id', verifyJWT, verifyAdmin, updateAdminProduct);
router.put('/:id', verifyJWT, verifyManager, updateProduct);
router.delete('/admin/:id', verifyJWT, verifyAdmin, deleteAdminProduct);
router.delete('/manager/:id', verifyJWT, verifyManager, deleteManagerProduct);
router.patch('/:id/toggle-home', verifyJWT, verifyAdmin, toggleShowOnHome);

module.exports = router;
