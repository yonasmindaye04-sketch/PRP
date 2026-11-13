import bcrypt from 'bcryptjs';
import { query, getClient } from '../config/database.js';
import { generateTokens, verifyRefreshToken } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

const hashPassword = async (password) => bcrypt.hash(password, 10);
const comparePassword = async (password, hash) => bcrypt.compare(password, hash);

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    throw new AppError('Username and password are required', 'VALIDATION_ERROR', 400);
  }
  
  const result = await query(
    `SELECT u.id, u.username, u.password_hash, u.name, u.role_id, u.is_active, r.name as role_name
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE u.username = $1`,
    [username]
  );
  
  if (result.rows.length === 0) {
    throw new AppError('Invalid credentials', 'UNAUTHORIZED', 401);
  }
  
  const user = result.rows[0];
  
  if (!user.is_active) {
    throw new AppError('Account is disabled', 'ACCOUNT_DISABLED', 403);
  }
  
  const validPassword = await comparePassword(password, user.password_hash);
  if (!validPassword) {
    throw new AppError('Invalid credentials', 'UNAUTHORIZED', 401);
  }
  
  // Update last login
  await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
  
  // Get user permissions
  const permResult = await query(
    `SELECT p.id, p.name FROM permissions p
     JOIN role_permissions rp ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [user.role_id]
  );
  
  const permissions = permResult.rows.map(p => p.id);
  
  const tokens = generateTokens(user);
  
  res.json({
    success: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        roleId: user.role_id,
        roleName: user.role_name
      },
      permissions,
      ...tokens
    }
  });
});

export const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    throw new AppError('Refresh token required', 'VALIDATION_ERROR', 400);
  }
  
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw new AppError('Invalid refresh token', 'INVALID_TOKEN', 401);
  }
  
  if (decoded.type !== 'refresh') {
    throw new AppError('Invalid token type', 'INVALID_TOKEN', 401);
  }
  
  const result = await query(
    `SELECT u.id, u.username, u.name, u.role_id, u.is_active, r.name as role_name
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE u.id = $1`,
    [decoded.userId]
  );
  
  if (result.rows.length === 0 || !result.rows[0].is_active) {
    throw new AppError('User not found or disabled', 'UNAUTHORIZED', 401);
  }
  
  const user = result.rows[0];
  const tokens = generateTokens(user);
  
  res.json({ success: true, data: tokens });
});

export const getProfile = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.username, u.name, u.email, u.phone, u.role_id, u.last_login, u.created_at, r.name as role_name
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE u.id = $1`,
    [req.user.id]
  );
  
  if (result.rows.length === 0) {
    throw new AppError('User not found', 'NOT_FOUND', 404);
  }
  
  // Get permissions
  const permResult = await query(
    `SELECT p.id, p.name FROM permissions p
     JOIN role_permissions rp ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [req.user.role_id]
  );
  
  const user = result.rows[0];
  res.json({
    success: true,
    data: {
      ...user,
      permissions: permResult.rows.map(p => p.id)
    }
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    throw new AppError('Current and new password required', 'VALIDATION_ERROR', 400);
  }
  
  if (newPassword.length < 6) {
    throw new AppError('New password must be at least 6 characters', 'VALIDATION_ERROR', 400);
  }
  
  const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const user = result.rows[0];
  
  const valid = await comparePassword(currentPassword, user.password_hash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 'UNAUTHORIZED', 401);
  }
  
  const newHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);
  
  res.json({ success: true, message: 'Password changed successfully' });
});

export const logout = asyncHandler(async (req, res) => {
  // In a stateless JWT setup, logout is handled client-side
  // Optionally, you could implement a token blacklist here
  res.json({ success: true, message: 'Logged out successfully' });
});