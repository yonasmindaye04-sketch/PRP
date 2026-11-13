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

// ============ EXPENSES ============

export const getExpenses = asyncHandler(async (req, res) => {
  const { startDate, endDate, category, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  if (startDate) {
    whereClause += ` AND expense_date >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    whereClause += ` AND expense_date <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  if (category) {
    whereClause += ` AND category = $${paramIndex}`;
    params.push(category);
    paramIndex++;
  }
  
  const countResult = await query(`SELECT COUNT(*) FROM expenses ${whereClause}`, params);
  const total = parseInt(countResult.rows[0].count);
  
  params.push(limit, offset);
  const result = await query(
    `SELECT e.*, u.name as recorded_by_name
     FROM expenses e
     LEFT JOIN users u ON e.user_id = u.id
     ${whereClause}
     ORDER BY e.expense_date DESC, e.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );
  
  res.json({
    success: true,
    data: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
  });
});

export const createExpense = asyncHandler(async (req, res) => {
  const { category, amount, description, expenseDate } = req.body;
  const userId = req.user.id;
  
  if (!category || !amount) {
    throw new AppError('Category and amount are required', 'VALIDATION_ERROR', 400);
  }
  
  if (amount <= 0) {
    throw new AppError('Amount must be positive', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    const id = await nextId('EXP', 'expenses', 'id', client);
    
    await client.query(
      `INSERT INTO expenses (id, user_id, category, amount, description, expense_date)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, category, amount, description || '', expenseDate || new Date().toISOString().split('T')[0]]
    );
    
    // Update open cash drawer expenses
    const drawerResult = await client.query(
      `SELECT id FROM cash_drawer WHERE user_id = $1 AND status = 'Open' ORDER BY opened_at DESC LIMIT 1`,
      [userId]
    );
    
    if (drawerResult.rows.length > 0) {
      await client.query(
        'UPDATE cash_drawer SET expenses = expenses + $1 WHERE id = $2',
        [amount, drawerResult.rows[0].id]
      );
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({ success: true, data: { id }, message: 'Expense recorded' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const updateExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { category, amount, description, expenseDate } = req.body;
  
  const updates = [];
  const params = [id];
  let paramIndex = 2;
  
  if (category !== undefined) { updates.push(`category = $${paramIndex++}`); params.push(category); }
  if (amount !== undefined) { updates.push(`amount = $${paramIndex++}`); params.push(amount); }
  if (description !== undefined) { updates.push(`description = $${paramIndex++}`); params.push(description); }
  if (expenseDate !== undefined) { updates.push(`expense_date = $${paramIndex++}`); params.push(expenseDate); }
  
  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 'VALIDATION_ERROR', 400);
  }
  
  const result = await query(`UPDATE expenses SET ${updates.join(', ')} WHERE id = $1`, params);
  
  if (result.rowCount === 0) {
    throw new AppError('Expense not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Expense updated' });
});

export const deleteExpense = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await query('DELETE FROM expenses WHERE id = $1', [id]);
  
  if (result.rowCount === 0) {
    throw new AppError('Expense not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Expense deleted' });
});

// ============ INCOME ============

export const getIncome = asyncHandler(async (req, res) => {
  const { startDate, endDate, category, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  if (startDate) {
    whereClause += ` AND income_date >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    whereClause += ` AND income_date <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  if (category) {
    whereClause += ` AND category = $${paramIndex}`;
    params.push(category);
    paramIndex++;
  }
  
  const countResult = await query(`SELECT COUNT(*) FROM income ${whereClause}`, params);
  const total = parseInt(countResult.rows[0].count);
  
  params.push(limit, offset);
  const result = await query(
    `SELECT i.*, u.name as recorded_by_name
     FROM income i
     LEFT JOIN users u ON i.user_id = u.id
     ${whereClause}
     ORDER BY i.income_date DESC, i.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );
  
  res.json({
    success: true,
    data: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
  });
});

export const createIncome = asyncHandler(async (req, res) => {
  const { category, amount, description, incomeDate } = req.body;
  const userId = req.user.id;
  
  if (!category || !amount) {
    throw new AppError('Category and amount are required', 'VALIDATION_ERROR', 400);
  }
  
  if (amount <= 0) {
    throw new AppError('Amount must be positive', 'VALIDATION_ERROR', 400);
  }
  
  const id = await nextId('INC', 'income', 'id', undefined);
  
  await query(
    `INSERT INTO income (id, user_id, category, amount, description, income_date)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, category, amount, description || '', incomeDate || new Date().toISOString().split('T')[0]]
  );
  
  res.status(201).json({ success: true, data: { id }, message: 'Income recorded' });
});

export const updateIncome = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { category, amount, description, incomeDate } = req.body;
  
  const updates = [];
  const params = [id];
  let paramIndex = 2;
  
  if (category !== undefined) { updates.push(`category = $${paramIndex++}`); params.push(category); }
  if (amount !== undefined) { updates.push(`amount = $${paramIndex++}`); params.push(amount); }
  if (description !== undefined) { updates.push(`description = $${paramIndex++}`); params.push(description); }
  if (incomeDate !== undefined) { updates.push(`income_date = $${paramIndex++}`); params.push(incomeDate); }
  
  if (updates.length === 0) {
    throw new AppError('No valid fields to update', 'VALIDATION_ERROR', 400);
  }
  
  const result = await query(`UPDATE income SET ${updates.join(', ')} WHERE id = $1`, params);
  
  if (result.rowCount === 0) {
    throw new AppError('Income record not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Income record updated' });
});

export const deleteIncome = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await query('DELETE FROM income WHERE id = $1', [id]);
  
  if (result.rowCount === 0) {
    throw new AppError('Income record not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, message: 'Income record deleted' });
});

// ============ PAYMENTS (Supplier Payments) ============

export const getPayments = asyncHandler(async (req, res) => {
  const { supplierId, startDate, endDate, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  if (supplierId) {
    whereClause += ` AND p.supplier_id = $${paramIndex}`;
    params.push(supplierId);
    paramIndex++;
  }
  if (startDate) {
    whereClause += ` AND p.payment_date >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    whereClause += ` AND p.payment_date <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  
  const countResult = await query(`SELECT COUNT(*) FROM payments p ${whereClause}`, params);
  const total = parseInt(countResult.rows[0].count);
  
  params.push(limit, offset);
  const result = await query(
    `SELECT p.*, s.name as supplier_name, u.name as recorded_by_name
     FROM payments p
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN users u ON p.user_id = u.id
     ${whereClause}
     ORDER BY p.payment_date DESC, p.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );
  
  res.json({
    success: true,
    data: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
  });
});

export const createPayment = asyncHandler(async (req, res) => {
  const { supplierId, amount, paymentMethod, paymentDate, notes } = req.body;
  const userId = req.user.id;
  
  if (!supplierId || !amount) {
    throw new AppError('Supplier and amount are required', 'VALIDATION_ERROR', 400);
  }
  
  if (amount <= 0) {
    throw new AppError('Amount must be positive', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Verify supplier
    const supResult = await client.query('SELECT * FROM suppliers WHERE id = $1', [supplierId]);
    if (supResult.rows.length === 0) {
      throw new AppError('Supplier not found', 'NOT_FOUND', 404);
    }
    
    const id = await nextId('PAY', 'payments', 'id', client);
    
    await client.query(
      `INSERT INTO payments (id, supplier_id, user_id, amount, payment_method, payment_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, supplierId, userId, amount, paymentMethod || 'Cash', paymentDate || new Date().toISOString().split('T')[0], notes || '']
    );
    
    // Reduce supplier balance (we owe them less)
    await client.query(
      'UPDATE suppliers SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
      [amount, supplierId]
    );
    
    await client.query('COMMIT');
    
    res.status(201).json({ success: true, data: { id }, message: 'Payment recorded' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const deletePayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    const paymentResult = await client.query('SELECT * FROM payments WHERE id = $1', [id]);
    if (paymentResult.rows.length === 0) {
      throw new AppError('Payment not found', 'NOT_FOUND', 404);
    }
    
    const payment = paymentResult.rows[0];
    
    // Reverse supplier balance
    await client.query(
      'UPDATE suppliers SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
      [payment.amount, payment.supplier_id]
    );
    
    await client.query('DELETE FROM payments WHERE id = $1', [id]);
    
    await client.query('COMMIT');
    res.json({ success: true, message: 'Payment deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ============ CASH DRAWER ============

export const getOpenShift = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT d.*, u.name as cashier_name
     FROM cash_drawer d
     LEFT JOIN users u ON d.user_id = u.id
     WHERE d.user_id = $1 AND d.status = 'Open'
     ORDER BY d.opened_at DESC LIMIT 1`,
    [req.user.id]
  );
  
  if (result.rows.length === 0) {
    return res.json({ success: true, data: null });
  }
  
  const drawer = result.rows[0];
  drawer.expectedBalance = parseFloat(drawer.opening_balance) + parseFloat(drawer.cash_sales) - parseFloat(drawer.expenses);
  
  res.json({ success: true, data: drawer });
});

export const startShift = asyncHandler(async (req, res) => {
  const { openingBalance } = req.body;
  const userId = req.user.id;
  
  if (openingBalance === undefined || openingBalance < 0) {
    throw new AppError('Valid opening balance is required', 'VALIDATION_ERROR', 400);
  }
  
  // Check if user already has an open shift
  const existingResult = await query(
    `SELECT id FROM cash_drawer WHERE user_id = $1 AND status = 'Open' LIMIT 1`,
    [userId]
  );
  
  if (existingResult.rows.length > 0) {
    throw new AppError('You already have an open shift', 'INVALID_STATE', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    const id = await nextId('DRW', 'cash_drawer', 'id', client);
    
    await client.query(
      `INSERT INTO cash_drawer (id, user_id, opening_balance, status)
       VALUES ($1, $2, $3, 'Open')`,
      [id, userId, openingBalance]
    );
    
    await client.query('COMMIT');
    
    res.status(201).json({ success: true, data: { id }, message: 'Shift started' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const endShift = asyncHandler(async (req, res) => {
  const { countedCash } = req.body;
  const userId = req.user.id;
  
  if (countedCash === undefined || countedCash < 0) {
    throw new AppError('Valid counted cash is required', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get open shift
    const drawerResult = await client.query(
      `SELECT * FROM cash_drawer WHERE user_id = $1 AND status = 'Open' ORDER BY opened_at DESC LIMIT 1`,
      [userId]
    );
    
    if (drawerResult.rows.length === 0) {
      throw new AppError('No open shift found', 'INVALID_STATE', 400);
    }
    
    const drawer = drawerResult.rows[0];
    
    const expected = parseFloat(drawer.opening_balance) + parseFloat(drawer.cash_sales) - parseFloat(drawer.expenses);
    const difference = countedCash - expected;
    
    // Snapshot shift sales
    const salesResult = await client.query(
      `SELECT si.product_id, p.name as product_name, si.product_id,
       SUM(si.quantity) as total_quantity, si.unit_price,
       SUM(si.line_total) as total_revenue
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       JOIN products p ON si.product_id = p.id
       WHERE s.user_id = $1 AND s.created_at >= $2
       GROUP BY si.product_id, p.name, si.unit_price`,
      [userId, drawer.opened_at]
    );
    
    for (const sale of salesResult.rows) {
      await client.query(
        `INSERT INTO shift_sales (cash_drawer_id, product_id, product_name, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [drawer.id, sale.product_id, sale.product_name, sale.total_quantity, sale.unit_price, sale.total_revenue]
      );
    }
    
    // Close the shift
    await client.query(
      `UPDATE cash_drawer 
       SET counted_cash = $1, closing_balance = $1, difference = $2, status = 'Closed', closed_at = NOW()
       WHERE id = $3`,
      [countedCash, difference, drawer.id]
    );
    
    await client.query('COMMIT');
    
    res.json({
      success: true,
      data: { expected, countedCash, difference },
      message: 'Shift ended'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const getShiftHistory = asyncHandler(async (req, res) => {
  const { userId, startDate, endDate, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  if (userId) {
    whereClause += ` AND d.user_id = $${paramIndex}`;
    params.push(userId);
    paramIndex++;
  }
  if (startDate) {
    whereClause += ` AND d.opened_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    whereClause += ` AND d.opened_at <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  
  const countResult = await query(`SELECT COUNT(*) FROM cash_drawer d ${whereClause}`, params);
  const total = parseInt(countResult.rows[0].count);
  
  params.push(limit, offset);
  const result = await query(
    `SELECT d.*, u.name as cashier_name
     FROM cash_drawer d
     LEFT JOIN users u ON d.user_id = u.id
     ${whereClause}
     ORDER BY d.opened_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );
  
  res.json({
    success: true,
    data: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
  });
});