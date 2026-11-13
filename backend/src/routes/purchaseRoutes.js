import { Router } from 'express';
import {
  createPurchase, getPurchases, getPurchaseById, deletePurchase, getPurchaseSummary
} from '../controllers/purchaseController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.post('/purchases', authorize('PERM_MANAGE_PURCHASES'), createPurchase);
router.get('/purchases', authorize('PERM_MANAGE_PURCHASES'), getPurchases);
router.get('/purchases/summary', authorize('PERM_MANAGE_PURCHASES'), getPurchaseSummary);
router.get('/purchases/:id', authorize('PERM_MANAGE_PURCHASES'), getPurchaseById);
router.delete('/purchases/:id', authorize('PERM_MANAGE_PURCHASES'), deletePurchase);

export default router;