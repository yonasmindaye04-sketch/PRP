import { query, getClient } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import dayjs from 'dayjs';

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

// FEFO: First Expiry First Out
const deductStockFEFO = async (client, productId, quantity, referenceId, referenceType, userId) => {
  const batchesResult = await client.query(
    `SELECT id, quantity, purchase_price FROM batches 
     WHERE product_id = $1 AND quantity > 0 AND is_active = true
     ORDER BY expiry_date ASC`,
    [productId]
  );
  
  const batches = batchesResult.rows;
  let remaining = quantity;
  const consumed = [];
  
  for (const batch of batches) {
    if (remaining <= 0) break;
    
    const take = Math.min(batch.quantity, remaining);
    const newQty = batch.quantity - take;
    
    await client.query('UPDATE batches SET quantity = $1 WHERE id = $2', [newQty, batch.id]);
    
    consumed.push({
      batchId: batch.id,
      quantity: take,
      unitCost: parseFloat(batch.purchase_price)
    });
    
    remaining -= take;
  }
  
  if (remaining > 0) {
    throw new AppError(`Insufficient stock. Need ${quantity}, available ${quantity - remaining}`, 'INSUFFICIENT_STOCK', 400);
  }
  
  // Recalculate inventory
  await recalculateInventory(client, productId);
  
  // Log stock movements
  for (const item of consumed) {
    const invResult = await client.query('SELECT current_stock FROM inventory WHERE product_id = $1', [productId]);
    const prevStock = invResult.rows[0]?.current_stock || 0;
    const newStock = prevStock - item.quantity;
    
    await client.query(
      `INSERT INTO stock_movements (product_id, batch_id, type, quantity, previous_stock, new_stock, reference_id, reference_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [productId, item.batchId, 'Sale', -item.quantity, prevStock, newStock, referenceId, referenceType, userId]
    );
  }
  
  return consumed;
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

const deductPillsFEFO = async (client, productId, pillsWanted, referenceId, referenceType, userId) => {
  // Get product info
  const prodResult = await client.query(
    'SELECT pills_per_unit FROM products WHERE id = $1', [productId]
  );
  const pillsPerUnit = prodResult.rows[0]?.pills_per_unit || 1;
  
  // Get inventory
  const invResult = await client.query(
    'SELECT current_stock, loose_pills, loose_pills_batch_id FROM inventory WHERE product_id = $1',
    [productId]
  );
  
  const inventory = invResult.rows[0] || { current_stock: 0, loose_pills: 0, loose_pills_batch_id: null };
  let loosePills = inventory.loose_pills;
  let loosePillsBatchId = inventory.loose_pills_batch_id;
  
  const consumed = [];
  
  // Case 1: Enough loose pills
  if (loosePills >= pillsWanted) {
    loosePills -= pillsWanted;
    
    await client.query(
      'UPDATE inventory SET loose_pills = $1 WHERE product_id = $2',
      [loosePills, productId]
    );
    
    await client.query(
      `INSERT INTO stock_movements (product_id, batch_id, type, quantity, previous_stock, new_stock, reference_id, reference_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [productId, loosePillsBatchId, 'Sale', -pillsWanted, inventory.current_stock, inventory.current_stock, referenceId, referenceType, userId]
    );
    
    let perPillCost = 0;
    if (loosePillsBatchId) {
      const batchResult = await client.query(
        'SELECT purchase_price FROM batches WHERE id = $1', [loosePillsBatchId]
      );
      perPillCost = parseFloat(batchResult.rows[0]?.purchase_price || 0) / pillsPerUnit;
    }
    
    return { batches: consumed, pillsBatchId: loosePillsBatchId, perPillCost };
  }
  
  // Case 2: Need to break strips
  const pillsStillNeeded = pillsWanted - loosePills;
  const unitsToBreak = Math.ceil(pillsStillNeeded / pillsPerUnit);
  
  // Deduct whole units via FEFO
  const stripConsumed = await deductStockFEFO(client, productId, unitsToBreak, referenceId, referenceType, userId);
  consumed.push(...stripConsumed);
  
  // Calculate new loose pills
  const pillsFromNewBreaks = unitsToBreak * pillsPerUnit;
  loosePills = loosePills + pillsFromNewBreaks - pillsWanted;
  loosePillsBatchId = stripConsumed[stripConsumed.length - 1]?.batchId || null;
  
  await client.query(
    'UPDATE inventory SET loose_pills = $1, loose_pills_batch_id = $2 WHERE product_id = $3',
    [loosePills, loosePillsBatchId, productId]
  );
  
  const totalPillsFromStrips = consumed.reduce((a, c) => a + c.quantity * pillsPerUnit, 0);
  const totalStripCost = consumed.reduce((a, c) => a + c.quantity * c.unitCost, 0);
  const perPillCost = totalPillsFromStrips > 0 ? totalStripCost / totalPillsFromStrips : 0;
  
  return { batches: consumed, pillsBatchId: loosePillsBatchId, perPillCost };
};

export const createSale = asyncHandler(async (req, res) => {
  const { cart, customerId, paymentMethod, discount, notes } = req.body;
  const userId = req.user.id;
  
  if (!cart || cart.length === 0) {
    throw new AppError('Cart cannot be empty', 'VALIDATION_ERROR', 400);
  }
  
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Validate stock for all items
    for (const item of cart) {
      const prodResult = await client.query(
        `SELECT p.*, COALESCE(i.current_stock, 0) as stock, COALESCE(i.loose_pills, 0) as loose_pills
         FROM products p LEFT JOIN inventory i ON p.id = i.product_id WHERE p.id = $1`,
        [item.productId]
      );
      
      if (prodResult.rows.length === 0) {
        throw new AppError(`Product ${item.productId} not found`, 'NOT_FOUND', 404);
      }
      
      const product = prodResult.rows[0];
      const availableStock = product.sell_by_pill 
        ? (product.stock * product.pills_per_unit + product.loose_pills)
        : product.stock;
      
      if (availableStock < item.qty) {
        throw new AppError(`Insufficient stock for ${product.name}. Available: ${availableStock}`, 'INSUFFICIENT_STOCK', 400);
      }
    }
    
    // Calculate totals
    let subtotal = 0;
    for (const item of cart) {
      subtotal += item.unitPrice * item.qty;
    }
    
    const discountAmount = discount || 0;
    const taxableAmount = subtotal - discountAmount;
    const taxRate = 0; // Could be from settings
    const taxAmount = taxableAmount * (taxRate / 100);
    const grandTotal = taxableAmount + taxAmount;
    
    // Create sale
    const saleId = await nextId('SALE', 'sales', 'id', client);
    
    await client.query(
      `INSERT INTO sales (id, user_id, customer_id, subtotal, discount, tax, grand_total, payment_method, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [saleId, userId, customerId || null, subtotal, discountAmount, taxAmount, grandTotal, paymentMethod || 'Cash', notes || '']
    );
    
    // Process each item
    for (const item of cart) {
      const prodResult = await client.query('SELECT * FROM products WHERE id = $1', [item.productId]);
      const product = prodResult.rows[0];
      
      if (product.sell_by_pill) {
        // Pill products: record the actual pills sold with a per-pill cost
        const pillSale = await deductPillsFEFO(client, item.productId, item.qty, saleId, 'Sale', userId);
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, batch_id, quantity, unit_price, margin_used, purchase_price, line_total)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [saleId, item.productId, pillSale.pillsBatchId, item.qty, item.unitPrice, item.marginUsed || 0, pillSale.perPillCost, item.qty * item.unitPrice]
        );
      } else {
        const consumed = await deductStockFEFO(client, item.productId, item.qty, saleId, 'Sale', userId);
        // Create sale items for each consumed batch
        for (const batchItem of consumed) {
          await client.query(
            `INSERT INTO sale_items (sale_id, product_id, batch_id, quantity, unit_price, margin_used, purchase_price, line_total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [saleId, item.productId, batchItem.batchId, batchItem.quantity, item.unitPrice, item.marginUsed || 0, batchItem.unitCost, batchItem.quantity * item.unitPrice]
          );
        }
      }
    }
    
    // Update cash drawer
    const fieldMap = { Cash: 'cash_sales', Card: 'card_sales', MobileMoney: 'mobile_money_sales' };
    const field = fieldMap[paymentMethod] || 'cash_sales';
    
    // Find open drawer for this user
    const drawerResult = await client.query(
      `SELECT id FROM cash_drawer WHERE user_id = $1 AND status = 'Open' ORDER BY opened_at DESC LIMIT 1`,
      [userId]
    );
    
    if (drawerResult.rows.length > 0) {
      await client.query(
        `UPDATE cash_drawer SET ${field} = ${field} + $1 WHERE id = $2`,
        [grandTotal, drawerResult.rows[0].id]
      );
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({ 
      success: true, 
      data: { saleId, grandTotal },
      message: 'Sale completed successfully'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const getSales = asyncHandler(async (req, res) => {
  const { startDate, endDate, userId, paymentMethod, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE 1=1';
  const params = [];
  let paramIndex = 1;
  
  // Cashiers can only see their own sales unless they have PERM_VIEW_SALES
  const canViewAll = req.user.role_id === 'ROLE_OWNER' || req.user.role_id === 'ROLE_PHARMACIST';
  if (!canViewAll) {
    whereClause += ` AND s.user_id = $${paramIndex}`;
    params.push(req.user.id);
    paramIndex++;
  } else if (userId) {
    whereClause += ` AND s.user_id = $${paramIndex}`;
    params.push(userId);
    paramIndex++;
  }
  
  if (startDate) {
    whereClause += ` AND s.created_at >= $${paramIndex}`;
    params.push(startDate);
    paramIndex++;
  }
  
  if (endDate) {
    whereClause += ` AND s.created_at <= $${paramIndex}`;
    params.push(endDate);
    paramIndex++;
  }
  
  if (paymentMethod) {
    whereClause += ` AND s.payment_method = $${paramIndex}`;
    params.push(paymentMethod);
    paramIndex++;
  }
  
  const countResult = await query(
    `SELECT COUNT(*) FROM sales s ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count);
  
  params.push(limit, offset);
  const result = await query(
    `SELECT s.id, s.user_id, u.name as cashier_name, s.customer_id, c.name as customer_name,
     s.subtotal, s.discount, s.tax, s.grand_total, s.payment_method, s.payment_status,
     s.notes, s.created_at
     FROM sales s
     LEFT JOIN users u ON s.user_id = u.id
     LEFT JOIN customers c ON s.customer_id = c.id
     ${whereClause}
     ORDER BY s.created_at DESC
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );
  
  res.json({
    success: true,
    data: result.rows,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / limit) }
  });
});

export const getSaleById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const saleResult = await query(
    `SELECT s.*, u.name as cashier_name, c.name as customer_name, c.phone as customer_phone
     FROM sales s
     LEFT JOIN users u ON s.user_id = u.id
     LEFT JOIN customers c ON s.customer_id = c.id
     WHERE s.id = $1`,
    [id]
  );
  
  if (saleResult.rows.length === 0) {
    throw new AppError('Sale not found', 'NOT_FOUND', 404);
  }
  
  const sale = saleResult.rows[0];
  
  // Check permission
  const canViewAll = req.user.role_id === 'ROLE_OWNER' || req.user.role_id === 'ROLE_PHARMACIST';
  if (!canViewAll && sale.user_id !== req.user.id) {
    throw new AppError('Access denied', 'FORBIDDEN', 403);
  }
  
  const itemsResult = await query(
    `SELECT si.*, p.name as product_name, b.expiry_date
     FROM sale_items si
     LEFT JOIN products p ON si.product_id = p.id
     LEFT JOIN batches b ON si.batch_id = b.id
     WHERE si.sale_id = $1`,
    [id]
  );
  
  sale.items = itemsResult.rows;
  res.json({ success: true, data: sale });
});

export const getSalesSummary = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  let whereClause = 'WHERE 1=1';
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
      COUNT(*) as transaction_count,
      COALESCE(SUM(grand_total), 0) as total_sales,
      COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN grand_total ELSE 0 END), 0) as cash_sales,
      COALESCE(SUM(CASE WHEN payment_method = 'Card' THEN grand_total ELSE 0 END), 0) as card_sales,
      COALESCE(SUM(CASE WHEN payment_method = 'MobileMoney' THEN grand_total ELSE 0 END), 0) as mobile_money_sales
     FROM sales ${whereClause}`,
    params
  );
  
  res.json({ success: true, data: result.rows[0] });
});