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

const recalculateInventory = async (productId, client) => {
  const batchResult = await client.query(
    'SELECT COALESCE(SUM(quantity), 0) as total FROM batches WHERE product_id = $1 AND is_active = true',
    [productId]
  );
  const total = parseInt(batchResult.rows[0].total) || 0;
  
  await client.query(
    `INSERT INTO inventory (product_id, current_stock, loose_pills)
     VALUES ($1, $2, 0)
     ON CONFLICT (product_id) DO UPDATE SET current_stock = $2, updated_at = NOW()`,
    [productId, total]
  );
  
  return total;
};

export const getProducts = asyncHandler(async (req, res) => {
  const { search, categoryId, lowStock, active } = req.query;
  
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  if (search) {
    whereClause += ` AND (p.name ILIKE $${paramIndex} OR p.id ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }
  
  if (categoryId) {
    whereClause += ` AND p.category_id = $${paramIndex}`;
    params.push(categoryId);
    paramIndex++;
  }
  
  if (active !== undefined) {
    whereClause += ` AND p.is_active = $${paramIndex}`;
    params.push(active === 'true');
    paramIndex++;
  }
  
  const result = await query(
    `SELECT 
      p.id, p.name, p.category_id, c.name as category_name,
      p.supplier_id, s.name as supplier_name,
      p.purchase_price, p.selling_price, p.tax_rate, p.reorder_level,
      p.default_margin, p.pills_per_unit, p.sell_by_pill, p.is_active,
      p.created_at, p.updated_at,
      COALESCE(i.current_stock, 0) as current_stock,
      COALESCE(i.loose_pills, 0) as loose_pills,
      i.loose_pills_batch_id
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN inventory i ON p.id = i.product_id
    ${whereClause}
    ORDER BY p.name`,
    params
  );
  
  // Calculate display stock for sell-by-pill products
  const products = result.rows.map(p => ({
    ...p,
    displayStock: p.sell_by_pill 
      ? (p.current_stock * p.pills_per_unit + p.loose_pills) 
      : p.current_stock,
    isLowStock: p.reorder_level > 0 ? p.current_stock <= p.reorder_level : p.current_stock <= 10
  }));
  
  // Filter low stock if requested
  let filtered = products;
  if (lowStock === 'true') {
    filtered = products.filter(p => p.isLowStock);
  }
  
  res.json({ success: true, data: filtered });
});

export const getProductById = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT 
      p.id, p.name, p.category_id, c.name as category_name,
      p.supplier_id, s.name as supplier_name,
      p.purchase_price, p.selling_price, p.tax_rate, p.reorder_level,
      p.default_margin, p.pills_per_unit, p.sell_by_pill, p.is_active,
      p.created_at, p.updated_at,
      COALESCE(i.current_stock, 0) as current_stock,
      COALESCE(i.loose_pills, 0) as loose_pills,
      i.loose_pills_batch_id
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    LEFT JOIN inventory i ON p.id = i.product_id
    WHERE p.id = $1`,
    [req.params.id]
  );
  
  if (result.rows.length === 0) {
    throw new AppError('Product not found', 'NOT_FOUND', 404);
  }
  
  const product = result.rows[0];
  product.displayStock = product.sell_by_pill 
    ? (product.current_stock * product.pills_per_unit + product.loose_pills) 
    : product.current_stock;
  
  // Get batches
  const batchesResult = await query(
    `SELECT id, quantity, purchase_price, selling_price, expiry_date, received_date, is_active
     FROM batches WHERE product_id = $1 AND is_active = true ORDER BY expiry_date ASC`,
    [req.params.id]
  );
  
  product.batches = batchesResult.rows;
  res.json({ success: true, data: product });
});

export const createProduct = asyncHandler(async (req, res) => {
  const {
    name, categoryId, supplierId, purchasePrice, sellingPrice,
    taxRate, reorderLevel, defaultMargin, pillsPerUnit, sellByPill
  } = req.body;
  
  if (!name || purchasePrice === undefined || sellingPrice === undefined) {
    throw new AppError('Name, purchase price, and selling price are required', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    const id = await nextId('MED', 'products', 'id', client);
    
    await client.query(
      `INSERT INTO products (id, name, category_id, supplier_id, purchase_price, selling_price,
       tax_rate, reorder_level, default_margin, pills_per_unit, sell_by_pill)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, name, categoryId || null, supplierId || null, purchasePrice, sellingPrice,
       taxRate || 0, reorderLevel || 0, defaultMargin || 25, pillsPerUnit || 1, sellByPill || false]
    );
    
    await client.query(
      `INSERT INTO inventory (product_id, current_stock, loose_pills) VALUES ($1, 0, 0)`,
      [id]
    );
    
    await client.query('COMMIT');
    
    res.status(201).json({ success: true, data: { id }, message: 'Product created' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  // Check if product exists
  const exists = await query('SELECT 1 FROM products WHERE id = $1', [id]);
  if (exists.rows.length === 0) {
    throw new AppError('Product not found', 'NOT_FOUND', 404);
  }
  
  const allowedFields = [
    'name', 'category_id', 'supplier_id', 'purchase_price', 'selling_price',
    'tax_rate', 'reorder_level', 'default_margin', 'pills_per_unit', 'sell_by_pill', 'is_active'
  ];
  
  const setClause = [];
  const params = [id];
  let paramIndex = 2;
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClause.push(`${field} = $${paramIndex}`);
      params.push(updates[field]);
      paramIndex++;
    }
  }
  
  if (setClause.length === 0) {
    throw new AppError('No valid fields to update', 'VALIDATION_ERROR', 400);
  }
  
  setClause.push('updated_at = NOW()');
  
  await query(
    `UPDATE products SET ${setClause.join(', ')} WHERE id = $1`,
    params
  );
  
  res.json({ success: true, message: 'Product updated' });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await query('DELETE FROM products WHERE id = $1', [id]);
  
  if (result.rowCount === 0) {
    throw new AppError('Product not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Product deleted' });
});

export const getCategories = asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT id, name, description, is_active FROM categories WHERE is_active = true ORDER BY name'
  );
  res.json({ success: true, data: result.rows });
});

export const createCategory = asyncHandler(async (req, res) => {
  const { name, description } = req.body;
  
  if (!name) {
    throw new AppError('Category name is required', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const id = await nextId('CAT', 'categories', 'id', client);
    
    await client.query(
      'INSERT INTO categories (id, name, description) VALUES ($1, $2, $3)',
      [id, name, description || '']
    );
    
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { id }, message: 'Category created' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description, isActive } = req.body;
  
  const updates = [];
  const params = [id];
  let paramIndex = 2;
  
  if (name !== undefined) { updates.push(`name = $${paramIndex++}`); params.push(name); }
  if (description !== undefined) { updates.push(`description = $${paramIndex++}`); params.push(description); }
  if (isActive !== undefined) { updates.push(`is_active = $${paramIndex++}`); params.push(isActive); }
  
  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 'VALIDATION_ERROR', 400);
  }
  
  updates.push('updated_at = NOW()');
  
  const result = await query(
    `UPDATE categories SET ${updates.join(', ')} WHERE id = $1`,
    params
  );
  
  if (result.rowCount === 0) {
    throw new AppError('Category not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Category updated' });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  // Check if category has products
  const productCheck = await query('SELECT 1 FROM products WHERE category_id = $1 LIMIT 1', [id]);
  if (productCheck.rows.length > 0) {
    throw new AppError('Cannot delete category with associated products', 'CONFLICT', 409);
  }
  
  const result = await query('DELETE FROM categories WHERE id = $1', [id]);
  
  if (result.rowCount === 0) {
    throw new AppError('Category not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Category deleted' });
});

export const getSuppliers = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, contact_person, phone, email, address, tax_number, 
     payment_terms, balance, is_active, created_at
     FROM suppliers WHERE is_active = true ORDER BY name`
  );
  res.json({ success: true, data: result.rows });
});

export const createSupplier = asyncHandler(async (req, res) => {
  const { name, contactPerson, phone, email, address, taxNumber, paymentTerms } = req.body;
  
  if (!name) {
    throw new AppError('Supplier name is required', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const id = await nextId('SUP', 'suppliers', 'id', client);
    
    await client.query(
      `INSERT INTO suppliers (id, name, contact_person, phone, email, address, tax_number, payment_terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, name, contactPerson || '', phone || '', email || '', address || '', taxNumber || '', paymentTerms || 30]
    );
    
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { id }, message: 'Supplier created' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  
  const allowedFields = ['name', 'contact_person', 'phone', 'email', 'address', 'tax_number', 'payment_terms', 'is_active'];
  
  const setClause = [];
  const params = [id];
  let paramIndex = 2;
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClause.push(`${field} = $${paramIndex}`);
      params.push(updates[field]);
      paramIndex++;
    }
  }
  
  if (setClause.length === 0) {
    throw new AppError('No valid fields to update', 'VALIDATION_ERROR', 400);
  }
  
  setClause.push('updated_at = NOW()');
  
  const result = await query(
    `UPDATE suppliers SET ${setClause.join(', ')} WHERE id = $1`,
    params
  );
  
  if (result.rowCount === 0) {
    throw new AppError('Supplier not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Supplier updated' });
});

export const deleteSupplier = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await query('DELETE FROM suppliers WHERE id = $1', [id]);
  
  if (result.rowCount === 0) {
    throw new AppError('Supplier not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Supplier deleted' });
});

export const adjustSupplierBalance = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { amount } = req.body; // positive = we owe more, negative = we paid
  
  if (amount === undefined || amount === null) {
    throw new AppError('Amount is required', 'VALIDATION_ERROR', 400);
  }
  
  await query(
    'UPDATE suppliers SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
    [amount, id]
  );
  
  res.json({ success: true, message: 'Supplier balance adjusted' });
});