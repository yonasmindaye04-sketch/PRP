import { Router } from 'express';
import {
  getProducts, getProductById, createProduct, updateProduct, deleteProduct,
  getCategories, createCategory, updateCategory, deleteCategory,
  getSuppliers, createSupplier, updateSupplier, deleteSupplier, adjustSupplierBalance
} from '../controllers/productController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Products
router.get('/products', authorize('PERM_VIEW_PRODUCTS'), getProducts);
router.get('/products/:id', authorize('PERM_VIEW_PRODUCTS'), getProductById);
router.post('/products', authorize('PERM_CREATE_PRODUCT'), createProduct);
router.put('/products/:id', authorize('PERM_EDIT_PRODUCT'), updateProduct);
router.delete('/products/:id', authorize('PERM_DELETE_PRODUCT'), deleteProduct);

// Categories
router.get('/categories', authorize('PERM_MANAGE_CATEGORIES'), getCategories);
router.post('/categories', authorize('PERM_MANAGE_CATEGORIES'), createCategory);
router.put('/categories/:id', authorize('PERM_MANAGE_CATEGORIES'), updateCategory);
router.delete('/categories/:id', authorize('PERM_MANAGE_CATEGORIES'), deleteCategory);

// Suppliers
router.get('/suppliers', authorize('PERM_MANAGE_SUPPLIERS'), getSuppliers);
router.post('/suppliers', authorize('PERM_MANAGE_SUPPLIERS'), createSupplier);
router.put('/suppliers/:id', authorize('PERM_MANAGE_SUPPLIERS'), updateSupplier);
router.delete('/suppliers/:id', authorize('PERM_MANAGE_SUPPLIERS'), deleteSupplier);
router.post('/suppliers/:id/balance', authorize('PERM_MANAGE_SUPPLIERS'), adjustSupplierBalance);

export default router;