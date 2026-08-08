import { Router } from 'express';
import { login, refreshToken, getProfile, changePassword, logout } from '../controllers/authController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// Public routes
router.post('/login', login);
router.post('/refresh', refreshToken);

// Protected routes
router.get('/profile', authenticate, getProfile);
router.post('/change-password', authenticate, changePassword);
router.post('/logout', authenticate, logout);

export default router;