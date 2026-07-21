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

  var todayStr = today();
  var todaysSales = sales.filter(function (s) { return new Date(s.SaleDate).toDateString() === todayStr; });
  var todaysTotal = todaysSales.reduce(function (sum, s) { return sum + Number(s.GrandTotal || 0); }, 0);
  var todaysExpenses = expenses.filter(function (e) { return new Date(e.ExpenseDate).toDateString() === todayStr; })
    .reduce(function (sum, e) { return sum + Number(e.Amount || 0); }, 0);

  var stockByProduct = {}; inventory.forEach(function (inv) { stockByProduct[inv.ProductID] = Number(inv.CurrentStock); });
  var lowStockCount = products.filter(function (p) { return (stockByProduct[p.ProductID] || 0) <= Number(p.ReorderLevel || 0); }).length;

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
