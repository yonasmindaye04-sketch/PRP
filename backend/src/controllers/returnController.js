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

export const createReturn = asyncHandler(async (req, res) => {
  const { saleId, productId, quantity, reason } = req.body;
  const userId = req.user.id;
  
  if (!saleId || !productId || !quantity || !reason) {
    throw new AppError('Sale ID, product ID, quantity, and reason are required', 'VALIDATION_ERROR', 400);
  }
  
  const validReasons = ['Damaged', 'Expired', 'WrongItem', 'CustomerReturn', 'Other'];
  if (!validReasons.includes(reason)) {
    throw new AppError('Invalid return reason', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Verify sale exists and get sale item
    const saleItemResult = await client.query(
      `SELECT si.*, s.user_id as cashier_id, s.payment_method
       FROM sale_items si
       JOIN sales s ON si.sale_id = s.id
       WHERE si.sale_id = $1 AND si.product_id = $2`,
      [saleId, productId]
    );
    
    if (saleItemResult.rows.length === 0) {
      throw new AppError('Sale item not found', 'NOT_FOUND', 404);
    }
    
    const saleItem = saleItemResult.rows[0];
    const totalSold = saleItem.quantity;
    
    // Check if already returned
    const returnCheck = await client.query(
      'SELECT COALESCE(SUM(quantity), 0) as returned FROM returns WHERE sale_id = $1 AND product_id = $2',
      [saleId, productId]
    );
    const alreadyReturned = parseInt(returnCheck.rows[0].returned) || 0;
    
    if (alreadyReturned + quantity > totalSold) {
      throw new AppError(`Cannot return more than sold. Sold: ${totalSold}, Already returned: ${alreadyReturned}`, 'VALIDATION_ERROR', 400);
    }
    
    // Get product info
    const prodResult = await client.query('SELECT * FROM products WHERE id = $1', [productId]);
    const product = prodResult.rows[0];
    
    const isResalable = reason !== 'Damaged' && reason !== 'Expired';
    const refundAmount = quantity * saleItem.unit_price;
    
    // Create return record
    const returnId = await nextId('RET', 'returns', 'id', client);
    
    await client.query(
      `INSERT INTO returns (id, sale_id, product_id, user_id, approved_by, quantity, reason, refund_amount, is_resalable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [returnId, saleId, productId, userId, userId, quantity, reason, refundAmount, isResalable]
    );
    
    if (isResalable) {
      if (product.sell_by_pill) {
        // Pill products: return pills to loose pill inventory instead of creating a strip batch
        const invResult = await client.query(
          'SELECT current_stock, loose_pills, loose_pills_batch_id FROM inventory WHERE product_id = $1',
          [productId]
        );
        const inv = invResult.rows[0] || { current_stock: 0, loose_pills: 0, loose_pills_batch_id: null };
        const newLoose = (inv.loose_pills || 0) + quantity;
        const batchId = inv.loose_pills_batch_id || saleItem.batch_id;

        await client.query(
          `INSERT INTO inventory (product_id, current_stock, loose_pills, loose_pills_batch_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (product_id) DO UPDATE SET loose_pills = $3, loose_pills_batch_id = $4, updated_at = NOW()`,
          [productId, inv.current_stock || 0, newLoose, batchId]
        );

        await client.query(
          `INSERT INTO stock_movements (product_id, batch_id, type, quantity, previous_stock, new_stock, reference_id, reference_type, created_by, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [productId, batchId, 'Return', quantity, inv.current_stock || 0, inv.current_stock || 0, returnId, 'Return', userId, 'Pills returned to loose inventory']
        );
      } else {
        // Create a new batch for resalable returns
        const batchId = await nextId('BAT', 'batches', 'id', client);
        
        await client.query(
          `INSERT INTO batches (id, product_id, quantity, purchase_price, selling_price, expiry_date, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [batchId, productId, quantity, saleItem.purchase_price, product.selling_price, '2099-12-31', true]
        );
        
        // Recalculate inventory
        const invResult = await client.query(
          'SELECT COALESCE(SUM(quantity), 0) as total FROM batches WHERE product_id = $1 AND is_active = true',
          [productId]
        );
        const total = parseInt(invResult.rows[0].total) || 0;
        
        await client.query(
          `INSERT INTO inventory (product_id, current_stock) VALUES ($1, $2)
           ON CONFLICT (product_id) DO UPDATE SET current_stock = $2, updated_at = NOW()`,
          [productId, total]
        );
        
        // Log stock movement
        const prevStock = total - quantity;
        await client.query(
          `INSERT INTO stock_movements (product_id, batch_id, type, quantity, previous_stock, new_stock, reference_id, reference_type, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [productId, batchId, 'Return', quantity, prevStock, total, returnId, 'Return', userId]
        );
      }
    } else {
      // Log stock movement with 0 quantity (audit only)
      await client.query(
        `INSERT INTO stock_movements (product_id, type, quantity, previous_stock, new_stock, reference_id, reference_type, created_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [productId, 'Return', 0, 0, 0, returnId, 'Return', userId, `Non-resalable: ${reason}`]
      );
    }
    
    // Update cash drawer
    const fieldMap = { Cash: 'cash_sales', Card: 'card_sales', MobileMoney: 'mobile_money_sales' };
    const field = fieldMap[saleItem.payment_method] || 'cash_sales';
    
    const drawerResult = await client.query(
      `SELECT id FROM cash_drawer WHERE user_id = $1 AND status = 'Open' ORDER BY opened_at DESC LIMIT 1`,
      [saleItem.cashier_id]
    );
    
    if (drawerResult.rows.length > 0) {
      await client.query(
        `UPDATE cash_drawer SET ${field} = ${field} - $1 WHERE id = $2`,
        [refundAmount, drawerResult.rows[0].id]
      );
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({ 
      success: true, 
      data: { returnId, refundAmount },
      message: 'Return processed successfully'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const getReturns = asyncHandler(async (req, res) => {
  const { startDate, endDate, reason, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  if (startDate) {
    whereClause += ` AND r.created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  
  if (endDate) {
    whereClause += ` AND r.created_at <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  
  if (reason) {
    whereClause += ` AND r.reason = $${paramIndex}`;
    params.push(reason);
    paramIndex++;
  }
  
  const countResult = await query(
    `SELECT COUNT(*) FROM returns r ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);
  
  params.push(limit, offset);
  const result = await query(
    `SELECT r.*, p.name as product_name, u.name as processed_by_name, s.id as sale_id
     FROM returns r
     LEFT JOIN products p ON r.product_id = p.id
     LEFT JOIN users u ON r.user_id = u.id
     LEFT JOIN sales s ON r.sale_id = s.id
     ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );
  
  res.json({
    success: true,
    data: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
  });
});

export const getReturnById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await query(
    `SELECT r.*, p.name as product_name, u.name as processed_by_name, s.id as sale_id
     FROM returns r
     LEFT JOIN products p ON r.product_id = p.id
     LEFT JOIN users u ON r.user_id = u.id
     LEFT JOIN sales s ON r.sale_id = s.id
     WHERE r.id = $1`,
    [id]
  );
  
  if (result.rows.length === 0) {
    throw new AppError('Return not found', 'NOT_FOUND', 404);
  }
  
  res.json({ success: true, data: result.rows[0] });
});