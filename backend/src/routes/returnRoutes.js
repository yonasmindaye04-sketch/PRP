import { Router } from 'express';
import { createReturn, getReturns, getReturnById } from '../controllers/returnController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.post('/returns', authorize('PERM_REFUND'), createReturn);
router.get('/returns', authorize('PERM_VIEW_SALES'), getReturns);
router.get('/returns/:id', authorize('PERM_VIEW_SALES'), getReturnById);

export default router;