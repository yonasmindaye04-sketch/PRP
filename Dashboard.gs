// ============================================================================
//  dashboard.gs — summary metrics + low-stock/expiry alerts
//  Computed live from the sheets on each load. Fine for small/medium
//  volumes; if this gets slow, start writing rollups into DashboardCache
//  after each sale/purchase instead of recomputing here.
// ============================================================================

function getDashboardSummary(userId) {
  return safe(function () {
  var user = authorize(userId, PERMISSIONS.VIEW_DASHBOARD);
  var sales = readTable(SHEETS.SALES).rows;
  var products = readTable(SHEETS.PRODUCTS).rows.filter(function (p) { return p.Active !== false && p.Active !== 'FALSE'; });
  var inventory = readTable(SHEETS.INVENTORY).rows;
  var expenses = readTable(SHEETS.EXPENSES).rows;

  var todayStr = new Date().toDateString();
  var todaysSales = sales.filter(function (s) { return new Date(s.SaleDate).toDateString() === todayStr; });
  var todaysTotal = todaysSales.reduce(function (sum, s) { return sum + Number(s.GrandTotal || 0); }, 0);
  var todaysExpenses = expenses.filter(function (e) { return new Date(e.ExpenseDate).toDateString() === todayStr; })
    .reduce(function (sum, e) { return sum + Number(e.Amount || 0); }, 0);

  var settings = getSettingsMap();
  var defaultLowStock = Number(settings.LowStockAlertThreshold || 0);
  var stockByProduct = {}; inventory.forEach(function (inv) { stockByProduct[inv.ProductID] = Number(inv.CurrentStock); });
  var lowStockCount = products.filter(function (p) {
    var threshold = (p.ReorderLevel !== undefined && p.ReorderLevel !== '' && Number(p.ReorderLevel) > 0) ? Number(p.ReorderLevel) : defaultLowStock;
    return (stockByProduct[p.ProductID] || 0) <= threshold;
  }).length;

  var expiringSoon = readTable(SHEETS.BATCHES).rows.filter(function (b) {
    if (Number(b.Quantity) <= 0 || !b.ExpiryDate) return false;
    var days = (new Date(b.ExpiryDate) - new Date()) / 86400000;
    return days >= 0 && days <= 90;
  }).length;

  var summary = {
    todaysSalesTotal: todaysTotal,
    todaysTransactionCount: todaysSales.length,
    todaysExpenses: todaysExpenses,
    totalProducts: products.length,
    lowStockCount: lowStockCount,
    expiringSoonCount: expiringSoon
  };

  if (hasPermission(user.RoleID, PERMISSIONS.VIEW_PROFIT)) {
    var saleItems = readTable(SHEETS.SALE_ITEMS).rows;
    var batches = readTable(SHEETS.BATCHES).rows;
    var costByBatch = {}; batches.forEach(function (b) { costByBatch[b.BatchID] = Number(b.PurchasePrice || 0); });
    var todaysSaleIds = {}; todaysSales.forEach(function (s) { todaysSaleIds[s.SaleID] = true; });
    var todaysCost = 0;
    saleItems.forEach(function (item) {
      if (todaysSaleIds[item.SaleID]) todaysCost += Number(item.Quantity) * (costByBatch[item.BatchID] || 0);
    });
    summary.todaysProfit = todaysTotal - todaysCost - todaysExpenses;
  }

  return ok({ summary: summary });
  })();
}

// Daily sales totals for the last `days` days (default 14) — powers the
// dashboard's sales trend chart.
function getSalesTrend(userId, days) {
  return safe(function () {
    authorize(userId, PERMISSIONS.VIEW_DASHBOARD);
    var n = Number(days) || 14;
    var sales = readTable(SHEETS.SALES).rows;

    var buckets = [];
    var totalsByDate = {};
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var key = d.toDateString();
      totalsByDate[key] = 0;
      buckets.push(key);
    }
    sales.forEach(function (s) {
      var key = new Date(s.SaleDate).toDateString();
      if (totalsByDate[key] !== undefined) totalsByDate[key] += Number(s.GrandTotal || 0);
    });

    var trend = buckets.map(function (key) {
      var d = new Date(key);
      return { label: (d.getMonth() + 1) + '/' + d.getDate(), total: Math.round(totalsByDate[key] * 100) / 100 };
    });
    return ok({ trend: trend });
  })();
}

// Top-selling products by revenue over the last `days` days (default 30).
function getTopProducts(userId, days, limit) {
  return safe(function () {
    authorize(userId, PERMISSIONS.VIEW_DASHBOARD);
    var n = Number(days) || 30;
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - n);

    var sales = readTable(SHEETS.SALES).rows;
    var recentSaleIds = {};
    sales.forEach(function (s) { if (new Date(s.SaleDate) >= cutoff) recentSaleIds[s.SaleID] = true; });

    var products = readTable(SHEETS.PRODUCTS).rows;
    var nameById = {}; products.forEach(function (p) { nameById[p.ProductID] = p.ProductName; });

    var totals = {};
    readTable(SHEETS.SALE_ITEMS).rows.forEach(function (item) {
      if (!recentSaleIds[item.SaleID]) return;
      totals[item.ProductID] = (totals[item.ProductID] || 0) + Number(item.Total || 0);
    });

    var ranked = Object.keys(totals).map(function (pid) {
      return { productId: pid, name: nameById[pid] || pid, total: Math.round(totals[pid] * 100) / 100 };
    });
    ranked.sort(function (a, b) { return b.total - a.total; });
    return ok({ products: ranked.slice(0, Number(limit) || 5) });
  })();
}

// Revenue by category over the last `days` days (default 30).
function getCategoryBreakdown(userId, days) {
  return safe(function () {
    authorize(userId, PERMISSIONS.VIEW_DASHBOARD);
    var n = Number(days) || 30;
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - n);

    var sales = readTable(SHEETS.SALES).rows;
    var recentSaleIds = {};
    sales.forEach(function (s) { if (new Date(s.SaleDate) >= cutoff) recentSaleIds[s.SaleID] = true; });

    var products = readTable(SHEETS.PRODUCTS).rows;
    var categoryByProduct = {}; products.forEach(function (p) { categoryByProduct[p.ProductID] = p.CategoryID; });
    var categories = readTable(SHEETS.CATEGORIES).rows;
    var categoryName = {}; categories.forEach(function (c) { categoryName[c.CategoryID] = c.CategoryName; });

    var totals = {};
    readTable(SHEETS.SALE_ITEMS).rows.forEach(function (item) {
      if (!recentSaleIds[item.SaleID]) return;
      var catId = categoryByProduct[item.ProductID] || 'Uncategorized';
      totals[catId] = (totals[catId] || 0) + Number(item.Total || 0);
    });

    var breakdown = Object.keys(totals).map(function (catId) {
      return { categoryId: catId, name: categoryName[catId] || 'Uncategorized', total: Math.round(totals[catId] * 100) / 100 };
    });
    breakdown.sort(function (a, b) { return b.total - a.total; });
    return ok({ breakdown: breakdown });
  })();
}

// Month-over-month and year-over-year revenue comparison. Owner/Pharmacist only.
function getPeriodComparison(userId) {
  return safe(function () {
    authorize(userId, PERMISSIONS.VIEW_PROFIT);
    var sales = readTable(SHEETS.SALES).rows;
    var now = new Date();

    function sumRange(start, end) {
      return sales.reduce(function (sum, s) {
        var d = new Date(s.SaleDate);
        return (d >= start && d < end) ? sum + Number(s.GrandTotal || 0) : sum;
      }, 0);
    }
    function pctChange(curr, prev) {
      if (!prev) return curr > 0 ? 100 : 0;
      return Math.round((curr - prev) / prev * 10000) / 100;
    }

    var startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    var startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var startOfThisYear = new Date(now.getFullYear(), 0, 1);
    var startOfLastYear = new Date(now.getFullYear() - 1, 0, 1);
    // Same year-to-date window last year, so the comparison is apples-to-apples
    // (e.g. "Jan 1 – Jul 21 this year" vs "Jan 1 – Jul 21 last year").
    var lastYearSameWindowEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1);

    var thisMonth = sumRange(startOfThisMonth, now);
    var lastMonth = sumRange(startOfLastMonth, startOfThisMonth);
    var thisYear = sumRange(startOfThisYear, now);
    var lastYear = sumRange(startOfLastYear, lastYearSameWindowEnd);

    return ok({
      comparison: {
        thisMonth: Math.round(thisMonth * 100) / 100, lastMonth: Math.round(lastMonth * 100) / 100,
        momChangePct: pctChange(thisMonth, lastMonth),
        thisYear: Math.round(thisYear * 100) / 100, lastYear: Math.round(lastYear * 100) / 100,
        yoyChangePct: pctChange(thisYear, lastYear)
      }
    });
  })();
}

// ============================================================================
//  Consolidated, period-driven dashboard payload — SINGLE SOURCE OF TRUTH
//  for the dashboard's analytical period. One call returns every
//  period-dependent widget dataset (KPIs, sales trend, best-selling products,
//  category split, profit trend) computed from the SAME date range, so the
//  sections can never silently disagree with each other.
//
//  startDate / endDate: 'YYYY-MM-DD' strings, both inclusive, interpreted in
//  the script's timezone. Missing/invalid input falls back to the last 30 days.
//  topN: how many best sellers to return (clamped to 1..50).
// ============================================================================
function getDashboardData(userId, startDate, endDate, topN) {
  return safe(function () {
    var user = authorize(userId, PERMISSIONS.VIEW_DASHBOARD);
    var period = resolveDashboardPeriod_(startDate, endDate);
    var canViewProfit = hasPermission(user.RoleID, PERMISSIONS.VIEW_PROFIT);
    var limit = Math.max(1, Math.min(50, Math.round(Number(topN) || 5)));

    // ── Period sales (valid transactions only, inclusive boundaries) ───────
    var sales = readTable(SHEETS.SALES).rows.filter(function (s) {
      if (!isCountableSale_(s)) return false;
      var d = new Date(s.SaleDate);
      return d >= period.start && d <= period.end;
    });
    var saleIds = {};
    var saleDateById = {};
    sales.forEach(function (s) {
      saleIds[s.SaleID] = true;
      saleDateById[s.SaleID] = new Date(s.SaleDate);
    });

    var expenses = readTable(SHEETS.EXPENSES).rows.filter(function (e) {
      var d = new Date(e.ExpenseDate);
      return d >= period.start && d <= period.end;
    });

    var salesTotal = 0;
    sales.forEach(function (s) { salesTotal += Number(s.GrandTotal || 0); });
    var expensesTotal = 0;
    expenses.forEach(function (e) { expensesTotal += Number(e.Amount || 0); });

    // ── Item-level aggregates (one pass): qty/revenue per product,
    //    revenue per category, COGS for profit ──────────────────────────────
    var saleItems = readTable(SHEETS.SALE_ITEMS).rows.filter(function (i) { return saleIds[i.SaleID]; });

    var products = readTable(SHEETS.PRODUCTS).rows;
    var nameById = {}, categoryByProduct = {};
    products.forEach(function (p) {
      nameById[p.ProductID] = p.ProductName;
      categoryByProduct[p.ProductID] = p.CategoryID;
    });
    var categoryName = {};
    readTable(SHEETS.CATEGORIES).rows.forEach(function (c) { categoryName[c.CategoryID] = c.CategoryName; });

    var batches = readTable(SHEETS.BATCHES).rows;
    var costByBatch = {};
    batches.forEach(function (b) { costByBatch[b.BatchID] = Number(b.PurchasePrice || 0); });

    var qtyByProduct = {}, revenueByProduct = {}, revenueByCategory = {}, cogsTotal = 0;
    saleItems.forEach(function (item) {
      var pid = item.ProductID;
      var qty = Number(item.Quantity) || 0;
      var rev = Number(item.Total) || 0;
      qtyByProduct[pid] = (qtyByProduct[pid] || 0) + qty;
      revenueByProduct[pid] = (revenueByProduct[pid] || 0) + rev;
      var catId = categoryByProduct[pid] || 'Uncategorized';
      revenueByCategory[catId] = (revenueByCategory[catId] || 0) + rev;
      cogsTotal += qty * (costByBatch[item.BatchID] || 0);
    });

    // ── Trend buckets (pre-filled with zero so quiet days still render) ────
    var buckets = buildTrendBuckets_(period);
    var bucketIndex = {};
    buckets.forEach(function (b, i) { bucketIndex[b.key] = i; });

    sales.forEach(function (s) {
      var i = bucketIndex[trendBucketKey_(new Date(s.SaleDate), period)];
      if (i !== undefined) {
        buckets[i].sales += Number(s.GrandTotal || 0);
        buckets[i].transactions += 1;
      }
    });
    var costByBucket = {};
    if (canViewProfit) {
      saleItems.forEach(function (item) {
        var sd = saleDateById[item.SaleID];
        if (!sd) return;
        var key = trendBucketKey_(sd, period);
        var i = bucketIndex[key];
        if (i !== undefined) {
          costByBucket[key] = (costByBucket[key] || 0) +
            (Number(item.Quantity) || 0) * (costByBatch[item.BatchID] || 0);
        }
      });
      expenses.forEach(function (e) {
        var i = bucketIndex[trendBucketKey_(new Date(e.ExpenseDate), period)];
        if (i !== undefined) buckets[i].expenses += Number(e.Amount || 0);
      });
    }

    var salesTrend = buckets.map(function (b) {
      return { date: b.date, label: b.label, sales: round2(b.sales), transactions: b.transactions };
    });
    var profitTrend = null;
    if (canViewProfit) {
      profitTrend = buckets.map(function (b) {
        var profit = b.sales - (costByBucket[b.key] || 0) - b.expenses;
        return { date: b.date, label: b.label, profit: round2(profit) };
      });
    }

    // ── Best-selling products — ranked by QUANTITY sold, revenue secondary ─
    var topProducts = Object.keys(qtyByProduct)
      .map(function (pid) {
        return {
          productId: pid,
          name: nameById[pid] || pid,
          quantity: qtyByProduct[pid],
          revenue: round2(revenueByProduct[pid] || 0)
        };
      })
      .filter(function (p) { return p.quantity > 0; })
      .sort(function (a, b) { return b.quantity - a.quantity || b.revenue - a.revenue; })
      .slice(0, limit);

    var categoryBreakdown = Object.keys(revenueByCategory)
      .map(function (catId) {
        return { categoryId: catId, name: categoryName[catId] || 'Uncategorized', total: round2(revenueByCategory[catId]) };
      })
      .sort(function (a, b) { return b.total - a.total; });

    var summary = {
      salesTotal: round2(salesTotal),
      transactionCount: sales.length,
      expensesTotal: round2(expensesTotal)
    };
    if (canViewProfit) summary.profit = round2(salesTotal - cogsTotal - expensesTotal);

    return ok({
      period: {
        start: fmtDateKey_(period.start),
        end: fmtDateKey_(period.end),
        days: period.days,
        granularity: period.granularity
      },
      summary: summary,
      snapshot: computeDashboardSnapshot_(products, batches),
      salesTrend: salesTrend,
      profitTrend: profitTrend,
      topProducts: topProducts,
      categoryBreakdown: categoryBreakdown
    });
  })();
}

// ── Dashboard period helpers ────────────────────────────────────────────────

// A sale counts toward analytics unless it was explicitly voided/cancelled
// (same convention as finance.gs shift reconciliation).
function isCountableSale_(s) {
  var st = String(s.Status || 'Completed').toLowerCase();
  return st !== 'voided' && st !== 'cancelled' && st !== 'deleted';
}

// Parses 'YYYY-MM-DD' (also tolerates full ISO datetimes) as a LOCAL date.
// Returns null on anything unparsable.
function parsePeriodDate_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(value));
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function resolveDashboardPeriod_(startDate, endDate) {
  var start = parsePeriodDate_(startDate);
  var end = parsePeriodDate_(endDate);
  if (!start && !end) {
    // Default: last 30 days (inclusive of today).
    var today = new Date();
    end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 29);
  } else if (!start) {
    start = end;
  } else if (!end) {
    end = start;
  }
  if (start > end) { var tmp = start; start = end; end = tmp; } // tolerate reversed input
  start = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
  end = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);

  var days = Math.round((dateOnly_(end) - dateOnly_(start)) / 86400000) + 1;
  // Aggregation granularity adapts to range length (short = daily, huge = monthly):
  //   ≤ 31 days → daily · ≤ ~6 months → weekly · otherwise monthly
  var granularity = days <= 31 ? 'day' : (days <= 186 ? 'week' : 'month');
  return { start: start, end: end, days: days, granularity: granularity };
}

function dateOnly_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function pad2_(n) { return ('0' + n).slice(-2); }
function fmtDateKey_(d) { return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate()); }
var MONTH_NAMES_SHORT_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Key of the bucket a date falls into, for the period's granularity.
function trendBucketKey_(d, period) {
  if (period.granularity === 'month') return d.getFullYear() + '-' + pad2_(d.getMonth() + 1);
  if (period.granularity === 'week') {
    var dayIndex = Math.round((dateOnly_(d) - dateOnly_(period.start)) / 86400000);
    return 'w' + Math.floor(dayIndex / 7);
  }
  return fmtDateKey_(d);
}

// Ordered, zero-filled buckets covering the whole period.
// day: every calendar day · week: 7-day windows counting from period start
// (final window may be shorter) · month: calendar months.
function buildTrendBuckets_(period) {
  var buckets = [];
  if (period.granularity === 'month') {
    var cursor = new Date(period.start.getFullYear(), period.start.getMonth(), 1);
    while (cursor <= period.end) {
      var key = cursor.getFullYear() + '-' + pad2_(cursor.getMonth() + 1);
      buckets.push(makeTrendBucket_(key, new Date(cursor),
        MONTH_NAMES_SHORT_[cursor.getMonth()] + ' ' + String(cursor.getFullYear()).slice(2)));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  } else if (period.granularity === 'week') {
    var winStart = dateOnly_(period.start);
    var w = 0;
    while (winStart <= period.end) {
      buckets.push(makeTrendBucket_('w' + w, winStart, (winStart.getMonth() + 1) + '/' + winStart.getDate()));
      winStart = new Date(winStart.getFullYear(), winStart.getMonth(), winStart.getDate() + 7);
      w++;
    }
  } else {
    var d = dateOnly_(period.start);
    while (d <= period.end) {
      buckets.push(makeTrendBucket_(fmtDateKey_(d), d, (d.getMonth() + 1) + '/' + d.getDate()));
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
  }
  return buckets;
}

function makeTrendBucket_(key, date, label) {
  return { key: key, date: fmtDateKey_(date), label: label, sales: 0, transactions: 0, expenses: 0 };
}

// Point-in-time metrics (stock levels & expiries are "right now" by nature,
// so they intentionally ignore the selected period).
function computeDashboardSnapshot_(products, batches) {
  var activeProducts = products.filter(function (p) { return p.Active !== false && p.Active !== 'FALSE'; });
  var settings = getSettingsMap();
  var defaultLowStock = Number(settings.LowStockAlertThreshold || 0);
  var stockByProduct = {};
  readTable(SHEETS.INVENTORY).rows.forEach(function (inv) { stockByProduct[inv.ProductID] = Number(inv.CurrentStock); });
  var lowStockCount = activeProducts.filter(function (p) {
    var threshold = (p.ReorderLevel !== undefined && p.ReorderLevel !== '' && Number(p.ReorderLevel) > 0) ? Number(p.ReorderLevel) : defaultLowStock;
    return (stockByProduct[p.ProductID] || 0) <= threshold;
  }).length;
  var expiringSoonCount = batches.filter(function (b) {
    if (Number(b.Quantity) <= 0 || !b.ExpiryDate) return false;
    var days = (new Date(b.ExpiryDate) - new Date()) / 86400000;
    return days >= 0 && days <= 90;
  }).length;
  return {
    totalProducts: activeProducts.length,
    lowStockCount: lowStockCount,
    expiringSoonCount: expiringSoonCount
  };
}

// Daily profit (revenue − cost of goods sold − expenses) for the last `days`
// days (default 14). Owner/Pharmacist only.
function getProfitTrend(userId, days) {
  return safe(function () {
    authorize(userId, PERMISSIONS.VIEW_PROFIT);
    var n = Number(days) || 14;
    var sales = readTable(SHEETS.SALES).rows;
    var saleItems = readTable(SHEETS.SALE_ITEMS).rows;
    var batches = readTable(SHEETS.BATCHES).rows;
    var expenses = readTable(SHEETS.EXPENSES).rows;

    var costByBatch = {}; batches.forEach(function (b) { costByBatch[b.BatchID] = Number(b.PurchasePrice || 0); });
    var saleDateById = {}; sales.forEach(function (s) { saleDateById[s.SaleID] = new Date(s.SaleDate).toDateString(); });

    var buckets = [];
    var revByDate = {}, costByDate = {}, expByDate = {};
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var key = d.toDateString();
      revByDate[key] = 0; costByDate[key] = 0; expByDate[key] = 0;
      buckets.push(key);
    }
    sales.forEach(function (s) {
      var key = new Date(s.SaleDate).toDateString();
      if (revByDate[key] !== undefined) revByDate[key] += Number(s.GrandTotal || 0);
    });
    saleItems.forEach(function (item) {
      var key = saleDateById[item.SaleID];
      if (key && costByDate[key] !== undefined) costByDate[key] += Number(item.Quantity) * (costByBatch[item.BatchID] || 0);
    });
    expenses.forEach(function (e) {
      var key = new Date(e.ExpenseDate).toDateString();
      if (expByDate[key] !== undefined) expByDate[key] += Number(e.Amount || 0);
    });

    var trend = buckets.map(function (key) {
      var d = new Date(key);
      var profit = revByDate[key] - costByDate[key] - expByDate[key];
      return { label: (d.getMonth() + 1) + '/' + d.getDate(), profit: Math.round(profit * 100) / 100 };
    });
    return ok({ trend: trend });
  })();
}
