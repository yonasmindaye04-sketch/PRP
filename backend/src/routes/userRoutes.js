import { Router } from 'express';
import {
  getUsers, getUserById, createUser, updateUser, deleteUser, resetPassword,
  getRoles, getPermissions, updateRolePermissions, getAuditLogs
} from '../controllers/userController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Users
router.get('/users', authorize('PERM_MANAGE_USERS'), getUsers);
router.get('/users/:id', authorize('PERM_MANAGE_USERS'), getUserById);
router.post('/users', authorize('PERM_MANAGE_USERS'), createUser);
router.put('/users/:id', authorize('PERM_MANAGE_USERS'), updateUser);
router.delete('/users/:id', authorize('PERM_MANAGE_USERS'), deleteUser);
router.post('/users/:id/reset-password', authorize('PERM_MANAGE_USERS'), resetPassword);

// Roles & Permissions
router.get('/roles', authorize('PERM_MANAGE_USERS'), getRoles);
router.get('/permissions', authorize('PERM_MANAGE_USERS'), getPermissions);
router.put('/roles/:id/permissions', authorize('PERM_MANAGE_USERS'), updateRolePermissions);

// Audit Logs
router.get('/audit-logs', authorize('PERM_VIEW_AUDIT_LOGS'), getAuditLogs);

export default router;