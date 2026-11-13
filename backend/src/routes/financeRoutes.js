import { Router } from 'express';
import {
  getExpenses, createExpense, updateExpense, deleteExpense,
  getIncome, createIncome, updateIncome, deleteIncome,
  getPayments, createPayment, deletePayment,
  getOpenShift, startShift, endShift, getShiftHistory
} from '../controllers/financeController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Expenses
router.get('/expenses', authorize('PERM_MANAGE_EXPENSES'), getExpenses);
router.post('/expenses', authorize('PERM_MANAGE_EXPENSES'), createExpense);
router.put('/expenses/:id', authorize('PERM_MANAGE_EXPENSES'), updateExpense);
router.delete('/expenses/:id', authorize('PERM_MANAGE_EXPENSES'), deleteExpense);

// Income
router.get('/income', authorize('PERM_MANAGE_EXPENSES'), getIncome);
router.post('/income', authorize('PERM_MANAGE_EXPENSES'), createIncome);
router.put('/income/:id', authorize('PERM_MANAGE_EXPENSES'), updateIncome);
router.delete('/income/:id', authorize('PERM_MANAGE_EXPENSES'), deleteIncome);

// Supplier Payments
router.get('/payments', authorize('PERM_MANAGE_SUPPLIERS'), getPayments);
router.post('/payments', authorize('PERM_MANAGE_SUPPLIERS'), createPayment);
router.delete('/payments/:id', authorize('PERM_MANAGE_SUPPLIERS'), deletePayment);

// Cash Drawer
router.get('/cashdrawer/open', authorize('PERM_MANAGE_CASHDRAWER'), getOpenShift);
router.post('/cashdrawer/start', authorize('PERM_MANAGE_CASHDRAWER'), startShift);
router.post('/cashdrawer/end', authorize('PERM_MANAGE_CASHDRAWER'), endShift);
router.get('/cashdrawer/history', authorize('PERM_VIEW_REPORTS'), getShiftHistory);

export default router;