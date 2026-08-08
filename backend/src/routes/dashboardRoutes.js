import { Router } from 'express';
import {
  getDashboardSummary, getSalesTrend, getTopProducts,
  getCategoryBreakdown, getProfitTrend, getPeriodComparison,
  getLowStockProducts, getExpiringProducts
} from '../controllers/dashboardController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/dashboard/summary', authorize('PERM_VIEW_DASHBOARD'), getDashboardSummary);
router.get('/dashboard/sales-trend', authorize('PERM_VIEW_DASHBOARD'), getSalesTrend);
router.get('/dashboard/top-products', authorize('PERM_VIEW_DASHBOARD'), getTopProducts);
router.get('/dashboard/category-breakdown', authorize('PERM_VIEW_DASHBOARD'), getCategoryBreakdown);
router.get('/dashboard/profit-trend', authorize('PERM_VIEW_PROFIT'), getProfitTrend);
router.get('/dashboard/period-comparison', authorize('PERM_VIEW_DASHBOARD'), getPeriodComparison);
router.get('/dashboard/low-stock', authorize('PERM_VIEW_DASHBOARD'), getLowStockProducts);
router.get('/dashboard/expiring', authorize('PERM_VIEW_DASHBOARD'), getExpiringProducts);

export default router;