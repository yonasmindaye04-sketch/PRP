import { Router } from 'express';
import {
  createSale, getSales, getSaleById, getSalesSummary
} from '../controllers/salesController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.post('/sales', authorize('PERM_SELL'), createSale);
router.get('/sales', getSales);
router.get('/sales/summary', authorize('PERM_VIEW_SALES'), getSalesSummary);
router.get('/sales/:id', authorize('PERM_VIEW_SALES'), getSaleById);

export default router;