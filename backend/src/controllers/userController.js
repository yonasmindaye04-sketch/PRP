import bcrypt from 'bcryptjs';
import { query, getClient } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

const nextId = async (prefix, table, idField, client) => {
  const result = await client.query(
    `SELECT ${idField} FROM ${table} WHERE ${idField} LIKE $1 ORDER BY ${idField} DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let nextNum = 1;
  if (result.rows.length > 0) {
    const lastId = result.rows[0][idField];
    const num = parseInt(lastId.replace(prefix, ''));
    if (!isNaN(num)) nextNum = num + 1;
  }
  return `${prefix}${String(nextNum).padStart(6, '0')}`;
};

const hashPassword = async (password) => bcrypt.hash(password, 10);

export const getUsers = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.username, u.name, u.email, u.phone, u.role_id, r.name as role_name,
     u.is_active, u.last_login, u.created_at
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     ORDER BY u.created_at DESC`
  );
  
  res.json({ success: true, data: result.rows });
});

export const getUserById = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.username, u.name, u.email, u.phone, u.role_id, r.name as role_name,
     u.is_active, u.last_login, u.created_at
     FROM users u
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE u.id = $1`,
    [req.params.id]
  );
  
  if (result.rows.length === 0) {
    throw new AppError('User not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, data: result.rows[0] });
});

export const createUser = asyncHandler(async (req, res) => {
  const { username, password, name, roleId, email, phone } = req.body;
  
  if (!username || !password || !name || !roleId) {
    throw new AppError('Username, password, name, and role are required', 'VALIDATION_ERROR', 400);
  }
  
  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters', 'VALIDATION_ERROR', 400);
  }
  
  // Check for duplicate username
  const duplicateCheck = await query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (duplicateCheck.rows.length > 0) {
    throw new AppError('Username already exists', 'CONFLICT', 409);
  }
  
  const passwordHash = await hashPassword(password);
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    const id = await nextId('USR', 'users', 'id', client);
    
    await client.query(
      `INSERT INTO users (id, username, password_hash, name, role_id, email, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, username, passwordHash, name, roleId, email || '', phone || '', true]
    );
    
    await client.query('COMMIT');
    
    res.status(201).json({ success: true, data: { id }, message: 'User created' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, roleId, email, phone, isActive } = req.body;
  
  const updates = [];
  const params = [id];
  let paramIndex = 2;
  
  if (name !== undefined) { updates.push(`name = $${paramIndex++}`); params.push(name); }
  if (roleId !== undefined) { updates.push(`role_id = $${paramIndex++}`); params.push(roleId); }
  if (email !== undefined) { updates.push(`email = $${paramIndex++}`); params.push(email); }
  if (phone !== undefined) { updates.push(`phone = $${paramIndex++}`); params.push(phone); }
  if (isActive !== undefined) { updates.push(`is_active = $${paramIndex++}`); params.push(isActive); }
  
  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 'VALIDATION_ERROR', 400);
  }
  
  updates.push('updated_at = NOW()');
  
  const result = await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $1`, params);
  
  if (result.rowCount === 0) {
    throw new AppError('User not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'User updated' });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  if (id === req.user.id) {
    throw new AppError('Cannot delete your own account', 'VALIDATION_ERROR', 400);
  }
  
  const result = await query('DELETE FROM users WHERE id = $1', [id]);
  
  if (result.rowCount === 0) {
    throw new AppError('User not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'User deleted' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;
  
  if (!newPassword || newPassword.length < 6) {
    throw new AppError('New password must be at least 6 characters', 'VALIDATION_ERROR', 400);
  }
  
  const passwordHash = await hashPassword(newPassword);
  
  const result = await query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [passwordHash, id]
  );
  
  if (result.rowCount === 0) {
    throw new AppError('User not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Password reset successfully' });
});

export const getRoles = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT r.id, r.name, r.description,
     COALESCE(json_agg(p.id) FILTER (WHERE p.id IS NOT NULL), '[]') as permissions
     FROM roles r
     LEFT JOIN role_permissions rp ON r.id = rp.role_id
     LEFT JOIN permissions p ON rp.permission_id = p.id
     GROUP BY r.id
     ORDER BY r.name`
  );
  
  res.json({ success: true, data: result.rows });
});

export const getPermissions = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id, name, description FROM permissions ORDER BY name'
  );
  
  res.json({ success: true, data: result.rows });
});

export const updateRolePermissions = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body;
  
  if (!Array.isArray(permissions)) {
    throw new AppError('Permissions must be an array', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Verify role exists
    const roleResult = await client.query('SELECT id FROM roles WHERE id = $1', [id]);
    if (roleResult.rows.length === 0) {
      throw new AppError('Role not found', 'NOT_FOUND', 404);
    }
    
    // Clear existing permissions
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
    
    // Insert new permissions
    for (const permId of permissions) {
      await client.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
        [id, permId]
      );
    }
    
    await client.query('COMMIT');
    
    res.json({ success: true, message: 'Role permissions updated' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const getAuditLogs = asyncHandler(async (req, res) => {
  const { userId, action, startDate, endDate, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  if (userId) {
    whereClause += ` AND al.user_id = $${paramIndex}`;
    params.push(userId);
    paramIndex++;
  }
  if (action) {
    whereClause += ` AND al.action = $${paramIndex}`;
    params.push(action);
    paramIndex++;
  }
  if (startDate) {
    whereClause += ` AND al.created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    whereClause += ` AND al.created_at <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  
  const countResult = await query(`SELECT COUNT(*) FROM audit_logs al ${whereClause}`, params);
  const total = parseInt(countResult.rows[0].count);
  
  params.push(limit, offset);
  const result = await query(
    `SELECT al.*, u.name as user_name, u.username
     FROM audit_logs al
     LEFT JOIN users u ON al.user_id = u.id
     ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );
  
  res.json({
    success: true,
    data: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
  });
});