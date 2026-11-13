import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required', code: 'UNAUTHORIZED' });
    }
    
    const token = authHeader.split(' ')[1];
    
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token', code: 'INVALID_TOKEN' });
    }
    
    // Get fresh user data from database
    const userResult = await query(
      `SELECT u.id, u.username, u.name, u.role_id, u.is_active, r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [decoded.userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found', code: 'USER_NOT_FOUND' });
    }
    
    const user = userResult.rows[0];
    
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account disabled', code: 'ACCOUNT_DISABLED' });
    }
    
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ success: false, message: 'Authentication error', code: 'INTERNAL_ERROR' });
  }
};

export const authorize = (permissionId) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required', code: 'UNAUTHORIZED' });
      }
      
      // Owner has all permissions
      if (req.user.role_id === 'ROLE_OWNER') {
        return next();
      }
      
      // Check permission
      const permResult = await query(
        `SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2`,
        [req.user.role_id, permissionId]
      );
      
      if (permResult.rows.length === 0) {
        return res.status(403).json({ 
          success: false, 
          message: 'Insufficient permissions', 
          code: 'FORBIDDEN',
          requiredPermission: permissionId
        });
      }
      
      next();
    } catch (err) {
      console.error('Authorization error:', err);
      res.status(500).json({ success: false, message: 'Authorization error', code: 'INTERNAL_ERROR' });
    }
  };
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const userResult = await query(
      `SELECT u.id, u.username, u.name, u.role_id, u.is_active, r.name as role_name
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [decoded.userId]
    );
    
    if (userResult.rows.length > 0 && userResult.rows[0].is_active) {
      req.user = userResult.rows[0];
    }
    
    next();
  } catch (err) {
    next();
  }
};

export const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, roleId: user.role_id },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
  
  const refreshToken = jwt.sign(
    { userId: user.id, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
  
  return { accessToken, refreshToken };
};

export const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET || JWT_SECRET);
};