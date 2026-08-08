import { query } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';

// ============ SETTINGS ============

export const getSettings = asyncHandler(async (req, res) => {
  const result = await query('SELECT key, value, description FROM settings ORDER BY key');
  
  const settings = {};
  for (const row of result.rows) {
    settings[row.key] = row.value;
  }
  
  res.json({ success: true, data: settings });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const updates = req.body;
  
  if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
    throw new AppError('No settings to update', 'VALIDATION_ERROR', 400);
  }
  
  for (const [key, value] of Object.entries(updates)) {
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, String(value)]
    );
  }
  
  res.json({ success: true, message: 'Settings updated' });
});

// ============ BUSINESS INFO ============

export const getBusinessInfo = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM business_info WHERE id = 1');
  
  if (result.rows.length === 0) {
    return res.json({ success: true, data: null });
  }
  
  res.json({ success: true, data: result.rows[0] });
});

export const updateBusinessInfo = asyncHandler(async (req, res) => {
  const updates = req.body;
  
  const allowedFields = ['name', 'address', 'phone', 'email', 'tax_number', 'logo_url', 'receipt_footer'];
  
  const setClause = [];
  const params = [];
  let paramIndex = 1;
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClause.push(`${field} = $${paramIndex++}`);
      params.push(updates[field]);
    }
  }
  
  if (setClause.length === 0) {
    throw new AppError('No valid fields to update', 'VALIDATION_ERROR', 400);
  }
  
  setClause.push('updated_at = NOW()');
  
  // Upsert business info
  const existing = await query('SELECT 1 FROM business_info WHERE id = 1');
  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO business_info (id, name, address, phone, email, tax_number, logo_url, receipt_footer)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7)`,
      [updates.name || '', updates.address || '', updates.phone || '', updates.email || '', updates.tax_number || '', updates.logo_url || '', updates.receipt_footer || '']
    );
  } else {
    await query(
      `UPDATE business_info SET ${setClause.join(', ')} WHERE id = 1`,
      params
    );
  }
  
  res.json({ success: true, message: 'Business info updated' });
});

// ============ MASTERS: CUSTOMERS ============

export const getCustomers = asyncHandler(async (req, res) => {
  const { search } = req.query;
  
  let whereClause = 'WHERE is_active = true';
  const params = [];
  
  if (search) {
    whereClause += ' AND (name ILIKE $1 OR phone ILIKE $1)';
    params.push(`%${search}%`);
  }
  
  const result = await query(
    `SELECT id, name, phone, email, address, is_active, created_at
     FROM customers ${whereClause} ORDER BY name`,
    params
  );
  
  res.json({ success: true, data: result.rows });
});

export const createCustomer = asyncHandler(async (req, res) => {
  const { name, phone, email, address } = req.body;
  
  if (!name) {
    throw new AppError('Customer name is required', 'VALIDATION_ERROR', 400);
  }
  
  const result = await query(
    `SELECT id FROM customers ORDER BY id DESC LIMIT 1`
  );
  
  let nextNum = 1;
  if (result.rows.length > 0) {
    const lastId = result.rows[0].id;
    const num = parseInt(lastId.replace('CUST', ''));
    if (!isNaN(num)) nextNum = num + 1;
  }
  
  const id = `CUST${String(nextNum).padStart(6, '0')}`;
  
  await query(
    `INSERT INTO customers (id, name, phone, email, address)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, name, phone || '', email || '', address || '']
  );
  
  res.status(201).json({ success: true, data: { id }, message: 'Customer created' });
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, address, isActive } = req.body;
  
  const updates = [];
  const params = [id];
  let paramIndex = 2;
  
  if (name !== undefined) { updates.push(`name = $${paramIndex++}`); params.push(name); }
  if (phone !== undefined) { updates.push(`phone = $${paramIndex++}`); params.push(phone); }
  if (email !== undefined) { updates.push(`email = $${paramIndex++}`); params.push(email); }
  if (address !== undefined) { updates.push(`address = $${paramIndex++}`); params.push(address); }
  if (isActive !== undefined) { updates.push(`is_active = $${paramIndex++}`); params.push(isActive); }
  
  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 'VALIDATION_ERROR', 400);
  }
  
  const result = await query(`UPDATE customers SET ${updates.join(', ')} WHERE id = $1`, params);
  
  if (result.rowCount === 0) {
    throw new AppError('Customer not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Customer updated' });
});

export const deleteCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await query('DELETE FROM customers WHERE id = $1', [id]);
  
  if (result.rowCount === 0) {
    throw new AppError('Customer not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Customer deleted' });
});