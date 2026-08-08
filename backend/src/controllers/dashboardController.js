import { query, getClient } from '../config/database.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import dayjs from 'dayjs';

// ============ DASHBOARD SUMMARY ============

export const getDashboardSummary = asyncHandler(async (req, res) => {
  const today = dayjs().format('YYYY-MM-DD');
  const startOfDay = `${today}T00:00:00`;
  const endOfDay = `${today}T23:59:59`;
  
  // Today's sales
  const salesResult = await query(
    `SELECT 
      COUNT(*) as transaction_count,
      COALESCE(SUM(grand_total), 0) as total_sales
     FROM sales WHERE created_at >= $1 AND created_at <= $2`,
    [startOfDay, endOfDay]
  );
  
  // Today's expenses
  const expenseResult = await query(
    `SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE expense_date = $1`,
    [today]
  );
  
  // Today's purchases
  const purchaseResult = await query(
    `SELECT COALESCE(SUM(grand_total), 0) as total_purchases 
     FROM purchases WHERE created_at >= $1 AND created_at <= $2 AND record_status = 'Active'`,
    [startOfDay, endOfDay]
  );
  
  // Product count
  const productResult = await query('SELECT COUNT(*) as count FROM products WHERE is_active = true');
  
  // Low stock count
  const lowStockResult = await query(
    `SELECT COUNT(*) as count
     FROM products p
     LEFT JOIN inventory i ON p.id = i.product_id
     WHERE p.is_active = true AND COALESCE(i.current_stock, 0) <= p.reorder_level
       AND p.reorder_level > 0`
  );
  
  // Expiry soon count (within 90 days)
  const expiryResult = await query(
    `SELECT COUNT(*) as count FROM batches 
     WHERE is_active = true AND quantity > 0 
     AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'`
  );
  
  // Today's profit (revenue - COGS)
  const profitResult = await query(
    `SELECT 
      COALESCE(SUM(si.line_total), 0) as revenue,
      COALESCE(SUM(si.quantity * si.purchase_price), 0) as cogs
     FROM sale_items si
     JOIN sales s ON si.sale_id = s.id
     WHERE s.created_at >= $1 AND s.created_at <= $2`,
    [startOfDay, endOfDay]
  );
  
  const canViewProfit = req.user.role_id === 'ROLE_OWNER' || req.user.role_id === 'ROLE_PHARMACIST';
  
  res.json({
    success: true,
    data: {
      today: {
        sales: parseFloat(salesResult.rows[0].total_sales),
        transactionCount: parseInt(salesResult.rows[0].transaction_count),
        expenses: parseFloat(expenseResult.rows[0].total_expenses),
        purchases: parseFloat(purchaseResult.rows[0].total_purchases),
        profit: canViewProfit ? parseFloat(profitResult.rows[0].revenue) - parseFloat(profitResult.rows[0].cogs) : null,
        revenue: canViewProfit ? parseFloat(profitResult.rows[0].revenue) : null,
        cogs: canViewProfit ? parseFloat(profitResult.rows[0].cogs) : null
      },
      inventory: {
        productCount: parseInt(productResult.rows[0].count),
        lowStock: parseInt(lowStockResult.rows[0].count),
        expirySoon: parseInt(expiryResult.rows[0].count)
      }
    }
  });
});

// ============ SALES TREND ============

export const getSalesTrend = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD');
  
  const result = await query(
    `SELECT 
      DATE(created_at) as date,
      COUNT(*) as transaction_count,
      COALESCE(SUM(grand_total), 0) as total_sales
     FROM sales
     WHERE created_at >= $1
     GROUP BY DATE(created_at)
     ORDER BY date`,
    [startDate]
  );
  
  // Fill in missing dates
  const data = [];
  const salesMap = {};
  for (const row of result.rows) {
    salesMap[dayjs(row.date).format('YYYY-MM-DD')] = row;
  }
  
  for (let i = 0; i < days; i++) {
    const date = dayjs().subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
    const row = salesMap[date];
    data.push({
      date,
      totalSales: row ? parseFloat(row.total_sales) : 0,
      transactionCount: row ? parseInt(row.transaction_count) : 0
    });
  }
  
  res.json({ success: true, data });
});

// ============ TOP PRODUCTS ============

export const getTopProducts = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const limit = parseInt(req.query.limit) || 10;
  const startDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
  
  const result = await query(
    `SELECT 
      p.id, p.name,
      COALESCE(SUM(si.quantity), 0) as total_quantity,
      COALESCE(SUM(si.line_total), 0) as total_revenue
     FROM sale_items si
     JOIN products p ON si.product_id = p.id
     JOIN sales s ON si.sale_id = s.id
     WHERE s.created_at >= $1
     GROUP BY p.id, p.name
     ORDER BY total_revenue DESC
     LIMIT $2`,
    [startDate, limit]
  );
  
  res.json({ success: true, data: result.rows });
});

// ============ CATEGORY BREAKDOWN ============

export const getCategoryBreakdown = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
  
  const result = await query(
    `SELECT 
      c.name as category_name,
      COALESCE(SUM(si.line_total), 0) as total_revenue,
      COALESCE(SUM(si.quantity), 0) as total_quantity
     FROM sale_items si
     JOIN products p ON si.product_id = p.id
     JOIN categories c ON p.category_id = c.id
     JOIN sales s ON si.sale_id = s.id
     WHERE s.created_at >= $1
     GROUP BY c.name
     ORDER BY total_revenue DESC`,
    [startDate]
  );
  
  res.json({ success: true, data: result.rows });
});

// ============ PROFIT TREND ============

export const getProfitTrend = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const startDate = dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD');
  
  const result = await query(
    `SELECT 
      DATE(s.created_at) as date,
      COALESCE(SUM(si.line_total), 0) as revenue,
      COALESCE(SUM(si.quantity * si.purchase_price), 0) as cogs
     FROM sale_items si
     JOIN sales s ON si.sale_id = s.id
     WHERE s.created_at >= $1
     GROUP BY DATE(s.created_at)
     ORDER BY date`,
    [startDate]
  );
  
  // Fill in missing dates
  const data = [];
  const profitMap = {};
  for (const row of result.rows) {
    profitMap[dayjs(row.date).format('YYYY-MM-DD')] = row;
  }
  
  for (let i = 0; i < days; i++) {
    const date = dayjs().subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
    const row = profitMap[date];
    const revenue = row ? parseFloat(row.revenue) : 0;
    const cogs = row ? parseFloat(row.cogs) : 0;
    data.push({
      date,
      revenue,
      cogs,
      profit: revenue - cogs
    });
  }
  
  res.json({ success: true, data });
});

// ============ PERIOD COMPARISON ============

export const getPeriodComparison = asyncHandler(async (req, res) => {
  const thisMonthStart = dayjs().startOf('month').format('YYYY-MM-DD');
  const lastMonthStart = dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
  const lastMonthEnd = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD');
  const thisYearStart = dayjs().startOf('year').format('YYYY-MM-DD');
  const lastYearStart = dayjs().subtract(1, 'year').startOf('year').format('YYYY-MM-DD');
  const lastYearEnd = dayjs().subtract(1, 'year').endOf('year').format('YYYY-MM-DD');
  
  // This month
  const thisMonthResult = await query(
    'SELECT COALESCE(SUM(grand_total), 0) as total FROM sales WHERE created_at >= $1',
    [thisMonthStart]
  );
  
  // Last month
  const lastMonthResult = await query(
    'SELECT COALESCE(SUM(grand_total), 0) as total FROM sales WHERE created_at >= $1 AND created_at <= $2',
    [lastMonthStart, lastMonthEnd]
  );
  
  // This year
  const thisYearResult = await query(
    'SELECT COALESCE(SUM(grand_total), 0) as total FROM sales WHERE created_at >= $1',
    [thisYearStart]
  );
  
  // Last year
  const lastYearResult = await query(
    'SELECT COALESCE(SUM(grand_total), 0) as total FROM sales WHERE created_at >= $1 AND created_at <= $2',
    [lastYearStart, lastYearEnd]
  );
  
  const thisMonth = parseFloat(thisMonthResult.rows[0].total);
  const lastMonth = parseFloat(lastMonthResult.rows[0].total);
  const thisYear = parseFloat(thisYearResult.rows[0].total);
  const lastYear = parseFloat(lastYearResult.rows[0].total);
  
  const monthChange = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : (thisMonth > 0 ? 100 : 0);
  const yearChange = lastYear > 0 ? ((thisYear - lastYear) / lastYear) * 100 : (thisYear > 0 ? 100 : 0);
  
  res.json({
    success: true,
    data: {
      thisMonth,
      lastMonth,
      monthChange: Math.round(monthChange * 10) / 10,
      thisYear,
      lastYear,
      yearChange: Math.round(yearChange * 10) / 10
    }
  });
});

// ============ LOW STOCK & EXPIRY LISTS ============

export const getLowStockProducts = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT 
      p.id, p.name, p.reorder_level, p.purchase_price, p.selling_price,
      COALESCE(i.current_stock, 0) as current_stock,
      COALESCE(i.loose_pills, 0) as loose_pills,
      p.sell_by_pill, p.pills_per_unit,
      c.name as category_name
     FROM products p
     LEFT JOIN inventory i ON p.id = i.product_id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.is_active = true AND p.reorder_level > 0
       AND COALESCE(i.current_stock, 0) <= p.reorder_level
     ORDER BY COALESCE(i.current_stock, 0) ASC`
  );
  
  res.json({ success: true, data: result.rows });
});

export const getExpiringProducts = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 90;
  
  const result = await query(
    `SELECT 
      b.id as batch_id, b.expiry_date, b.quantity as batch_quantity,
      p.id as product_id, p.name as product_name, p.purchase_price,
      c.name as category_name
     FROM batches b
     JOIN products p ON b.product_id = p.id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE b.is_active = true AND b.quantity > 0
       AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval
     ORDER BY b.expiry_date ASC`,
    [days]
  );
  
  res.json({ success: true, data: result.rows });
});