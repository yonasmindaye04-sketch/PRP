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

const recalculateInventory = async (client, productId) => {
  const result = await client.query(
    'SELECT COALESCE(SUM(quantity), 0) as total FROM batches WHERE product_id = $1 AND is_active = true',
    [productId]
  );
  const total = parseInt(result.rows[0].total) || 0;
  
  await client.query(
    `INSERT INTO inventory (product_id, current_stock) VALUES ($1, $2)
     ON CONFLICT (product_id) DO UPDATE SET current_stock = $2, updated_at = NOW()`,
    [productId, total]
  );
  
  return total;
};

export const createPurchase = asyncHandler(async (req, res) => {
  const { supplierId, items, discount, tax, paidAmount, notes } = req.body;
  const userId = req.user.id;
  
  if (!supplierId || !items || items.length === 0) {
    throw new AppError('Supplier and items are required', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Verify supplier exists
    const supResult = await client.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
    if (supResult.rows.length === 0) {
      throw new AppError('Supplier not found', 'NOT_FOUND', 404);
    }
    
    // Calculate totals
    let subtotal = 0;
    for (const item of items) {
      subtotal += item.purchasePrice * item.quantity;
    }
    
    const discountAmount = discount || 0;
    const taxableAmount = subtotal - discountAmount;
    const taxAmount = tax || 0;
    const grandTotal = taxableAmount + taxAmount;
    const paid = paidAmount || 0;
    
    let paymentStatus = 'Unpaid';
    if (paid >= grandTotal) paymentStatus = 'Paid';
    else if (paid > 0) paymentStatus = 'Partial';
    
    // Create purchase
    const purchaseId = await nextId('PUR', 'purchases', 'id', client);
    
    await client.query(
      `INSERT INTO purchases (id, supplier_id, user_id, subtotal, discount, tax, grand_total, paid_amount, payment_status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [purchaseId, supplierId, userId, subtotal, discountAmount, taxAmount, grandTotal, paid, paymentStatus, notes || '']
    );
    
    // Process each item
    for (const item of items) {
      // Verify product exists
      const prodResult = await client.query('SELECT * FROM products WHERE id = $1', [item.productId]);
      if (prodResult.rows.length === 0) {
        throw new AppError(`Product ${item.productId} not found`, 'NOT_FOUND', 404);
      }
      
      const product = prodResult.rows[0];
      
      // Determine selling price
      let sellingPrice = item.sellingPrice;
      if (!sellingPrice) {
        if (item.purchasePrice > product.purchase_price) {
          sellingPrice = item.purchasePrice * (1 + (product.default_margin || 25) / 100);
        } else {
          sellingPrice = product.selling_price;
        }
      }
      
      // Create batch
      const batchId = await nextId('BAT', 'batches', 'id', client);
      
      await client.query(
        `INSERT INTO batches (id, product_id, supplier_id, quantity, purchase_price, selling_price, expiry_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [batchId, item.productId, supplierId, item.quantity, item.purchasePrice, sellingPrice, item.expiryDate]
      );
      
      // Recalculate inventory
      await recalculateInventory(client, item.productId);
      
      // Log stock movement
      const invResult = await client.query('SELECT current_stock FROM inventory WHERE product_id = $1', [item.productId]);
      const prevStock = invResult.rows[0]?.current_stock - item.quantity || 0;
      const newStock = prevStock + item.quantity;
      
      await client.query(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, previous_stock, new_stock, reference_id, reference_type, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [item.productId, batchId, 'Purchase', item.quantity, prevStock, newStock, purchaseId, 'Purchase', userId]
      );
      
      // Create purchase item
      await client.query(
        `INSERT INTO purchase_items (purchase_id, product_id, batch_id, quantity, purchase_price, selling_price, expiry_date, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [purchaseId, item.productId, batchId, item.quantity, item.purchasePrice, sellingPrice, item.expiryDate, item.purchasePrice * item.quantity]
      );
      
      // Update product prices if purchase price increased
      if (item.purchasePrice > product.purchase_price) {
        await client.query(
          `UPDATE products SET purchase_price = $1, selling_price = $2, updated_at = NOW() WHERE id = $3`,
          [item.purchasePrice, sellingPrice, item.productId]
        );
      }
    }
    
    // Adjust supplier balance (we owe them more)
    const balanceChange = grandTotal - paid;
    if (balanceChange > 0) {
      await client.query(
        'UPDATE suppliers SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
        [balanceChange, supplierId]
      );
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({ 
      success: true, 
      data: { purchaseId, grandTotal, paymentStatus },
      message: 'Purchase created successfully'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const getPurchases = asyncHandler(async (req, res) => {
  const { supplierId, startDate, endDate, paymentStatus, page = 1, limit = 50 } = req.query;
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
    whereClause += ` AND p.created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  
  if (endDate) {
    whereClause += ` AND p.created_at <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  
  if (paymentStatus) {
    whereClause += ` AND p.payment_status = $${paramIndex}`;
    params.push(paymentStatus);
    paramIndex++;
  }
  
  whereClause += ` AND p.record_status = 'Active'`;
  
  const countResult = await query(
    `SELECT COUNT(*) FROM purchases p ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);
  
  params.push(limit, offset);
  const result = await query(
    `SELECT p.*, s.name as supplier_name, u.name as created_by_name
     FROM purchases p
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN users u ON p.user_id = u.id
     ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );
  
  res.json({
    success: true,
    data: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
  });
});

export const getPurchaseById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const purchaseResult = await query(
    `SELECT p.*, s.name as supplier_name, s.phone as supplier_phone, s.email as supplier_email,
     s.address as supplier_address, s.tax_number as supplier_tax_number, s.payment_terms,
     u.name as created_by_name
     FROM purchases p
     LEFT JOIN suppliers s ON p.supplier_id = s.id
     LEFT JOIN users u ON p.user_id = u.id
     WHERE p.id = $1`,
    [id]
  );
  
  if (purchaseResult.rows.length === 0) {
    throw new AppError('Purchase not found', 'NOT_FOUND', 404);
  }
  
  const purchase = purchaseResult.rows[0];
  
  // Get items
  const itemsResult = await query(
    `SELECT pi.*, p.name as product_name
     FROM purchase_items pi
     LEFT JOIN products p ON pi.product_id = p.id
     WHERE pi.purchase_id = $1`,
    [id]
  );
  
  // Get payment history
  const paymentsResult = await query(
    `SELECT pm.*, u.name as recorded_by_name
     FROM payments pm
     LEFT JOIN users u ON pm.user_id = u.id
     WHERE pm.supplier_id = $1
     ORDER BY pm.payment_date DESC`,
    [purchase.supplier_id]
  );
  
  purchase.items = itemsResult.rows;
  purchase.payments = paymentsResult.rows;
  
  // Calculate balance due
  purchase.balanceDue = purchase.grand_total - purchase.paid_amount;
  
  res.json({ success: true, data: purchase });
});

export const deletePurchase = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const userId = req.user.id;
  
  // Only Owner can delete purchases
  if (req.user.role_id !== 'ROLE_OWNER') {
    throw new AppError('Only the Owner can delete a purchase', 'FORBIDDEN', 403);
  }
  
  if (!reason) {
    throw new AppError('Delete reason is required', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Get purchase details
    const purchaseResult = await client.query(
      'SELECT * FROM purchases WHERE id = $1 AND record_status = \'Active\'',
      [id]
    );
    
    if (purchaseResult.rows.length === 0) {
      throw new AppError('Purchase not found or already deleted', 'NOT_FOUND', 404);
    }
    
    const purchase = purchaseResult.rows[0];
    
    // Get items to reverse stock
    const itemsResult = await client.query(
      'SELECT * FROM purchase_items WHERE purchase_id = $1',
      [id]
    );
    
    // Reverse stock for each item
    for (const item of itemsResult.rows) {
      // Reduce batch quantity
      await client.query(
        'UPDATE batches SET quantity = quantity - $1 WHERE id = $2',
        [item.quantity, item.batch_id]
      );
      
      // If batch quantity goes to 0, mark inactive
      await client.query(
        'UPDATE batches SET is_active = false WHERE id = $1 AND quantity <= 0',
        [item.batch_id]
      );
      
      // Recalculate inventory
      await recalculateInventory(client, item.product_id);
      
      // Log stock movement
      const invResult = await client.query('SELECT current_stock FROM inventory WHERE product_id = $1', [item.product_id]);
      const prevStock = invResult.rows[0]?.current_stock || 0;
      const newStock = Math.max(0, prevStock - item.quantity);
      
      await client.query(
        `INSERT INTO stock_movements (product_id, batch_id, type, quantity, previous_stock, new_stock, reference_id, reference_type, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [item.product_id, item.batch_id, 'Return', -item.quantity, prevStock, newStock, id, 'PurchaseReturn', userId]
      );
    }
    
    // Reverse supplier balance for unpaid portion
    const unpaidAmount = purchase.grand_total - purchase.paid_amount;
    if (unpaidAmount > 0) {
      await client.query(
        'UPDATE suppliers SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
        [unpaidAmount, purchase.supplier_id]
      );
    }
    
    // Mark purchase as deleted
    await client.query(
      `UPDATE purchases SET record_status = 'Deleted', delete_reason = $1, updated_at = NOW() WHERE id = $2`,
      [reason, id]
    );
    
    await client.query('COMMIT');
    
    res.json({ success: true, message: 'Purchase deleted and stock reversed' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const getPurchaseSummary = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  let whereClause = "WHERE record_status = 'Active'";
  const params = [];
  let paramIndex = 1;
  
  if (startDate) {
    whereClause += ` AND created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  if (endDate) {
    whereClause += ` AND created_at <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  
  const result = await query(
    `SELECT 
      COUNT(*) as purchase_count,
      COALESCE(SUM(grand_total), 0) as total_purchases,
      COALESCE(SUM(paid_amount), 0) as total_paid,
      COALESCE(SUM(grand_total - paid_amount), 0) as total_due
     FROM purchases ${whereClause}`,
    params
  );
  
  res.json({ success: true, data: result.rows[0] });
});