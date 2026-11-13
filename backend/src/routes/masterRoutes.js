import { Router } from 'express';
import {
  getSettings, updateSettings,
  getBusinessInfo, updateBusinessInfo,
  getCustomers, createCustomer, updateCustomer, deleteCustomer
} from '../controllers/masterController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Settings
router.get('/settings', getSettings);
router.put('/settings', authorize('PERM_MANAGE_SETTINGS'), updateSettings);

// Business Info
router.get('/business-info', getBusinessInfo);
router.put('/business-info', authorize('PERM_MANAGE_SETTINGS'), updateBusinessInfo);

// Customers
router.get('/customers', authorize('PERM_MANAGE_CUSTOMERS'), getCustomers);
router.post('/customers', authorize('PERM_MANAGE_CUSTOMERS'), createCustomer);
router.put('/customers/:id', authorize('PERM_MANAGE_CUSTOMERS'), updateCustomer);
router.delete('/customers/:id', authorize('PERM_MANAGE_CUSTOMERS'), deleteCustomer);

export default router;