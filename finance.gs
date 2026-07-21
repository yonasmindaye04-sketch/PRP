// ============================================================================
//  finance.gs — Expenses, Income, Supplier Payments, Cash Drawer
// ============================================================================

// ── Expenses ──────────────────────────────────────────────────────────────
function createExpense(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_EXPENSES);
  if (!input.category || !input.amount) return fail('Category and amount are required.');
  var id = nextId('EXP', SHEETS.EXPENSES, 'ExpenseID');
  appendRow(SHEETS.EXPENSES, {
    ExpenseID: id, ExpenseDate: input.date || nowIso(), Category: input.category,
    Description: input.description || '', Amount: Number(input.amount), PaymentMethod: input.paymentMethod || 'Cash',
    ApprovedBy: input.approvedBy || userId, CreatedBy: userId
  });
  logAudit(userId, 'Expenses', 'CREATE', id, null, input.amount);
  return ok({ expenseId: id });
  })();
}

function getExpenses(userId, limit) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_EXPENSES);
  var rows = readTable(SHEETS.EXPENSES).rows;
  rows.sort(function (a, b) { return new Date(b.ExpenseDate) - new Date(a.ExpenseDate); });
  if (limit) rows = rows.slice(0, limit);
  return ok({ expenses: rows });
  })();
}

// ── Income (non-sales) ──────────────────────────────────────────────────
function createIncome(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_EXPENSES);
  if (!input.source || !input.amount) return fail('Source and amount are required.');
  var id = nextId('INC', SHEETS.INCOME, 'IncomeID');
  appendRow(SHEETS.INCOME, {
    IncomeID: id, Date: input.date || nowIso(), Source: input.source,
    Description: input.description || '', Amount: Number(input.amount), ReceivedBy: userId
  });
  logAudit(userId, 'Income', 'CREATE', id, null, input.amount);
  return ok({ incomeId: id });
  })();
}

function getIncome(userId, limit) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_EXPENSES);
  var rows = readTable(SHEETS.INCOME).rows;
  rows.sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); });
  if (limit) rows = rows.slice(0, limit);
  return ok({ income: rows });
  })();
}

// ── Supplier Payments ────────────────────────────────────────────────────
function createPayment(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_SUPPLIERS);
  if (!input.supplierId || !input.amount) return fail('Supplier and amount are required.');
  var amount = Number(input.amount);
  if (amount <= 0) return fail('Amount must be greater than zero.');

  var purchase = null;
  if (input.purchaseId) {
    purchase = findRowById(SHEETS.PURCHASES, 'PurchaseID', input.purchaseId);
    if (!purchase) return fail('That purchase could not be found.');
    if (purchase.RecordStatus === 'Deleted') return fail('That purchase has been deleted and can no longer be paid against.');
    if (purchase.SupplierID !== input.supplierId) return fail('That purchase belongs to a different supplier.');
    if (amount > Number(purchase.Balance || 0) + 0.01) {
      return fail('Amount ($' + Number(purchase.Balance).toFixed(2) + ' owed) is less than the payment entered.');
    }
  }

  var id = nextId('PAY', SHEETS.PAYMENTS, 'PaymentID');
  appendRow(SHEETS.PAYMENTS, {
    PaymentID: id, Date: nowIso(), SupplierID: input.supplierId, PurchaseID: input.purchaseId || '',
    Amount: amount, Method: input.method || 'Cash', Reference: input.reference || '', ReceivedBy: userId
  });
  adjustSupplierBalance(input.supplierId, -amount);
  if (purchase) {
    var newPaid = Number(purchase.PaidAmount || 0) + amount;
    var newBalance = Number(purchase.GrandTotal) - newPaid;
    updateRowById(SHEETS.PURCHASES, 'PurchaseID', input.purchaseId, {
      PaidAmount: newPaid, Balance: newBalance, PaymentStatus: newBalance <= 0.01 ? 'Paid' : 'Partial'
    });
  }
  logAudit(userId, 'Payments', 'CREATE', id, null, { supplierId: input.supplierId, purchaseId: input.purchaseId || null, amount: amount });
  return ok({ paymentId: id });
  })();
}

function getPayments(userId, limit) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_SUPPLIERS);
  var rows = readTable(SHEETS.PAYMENTS).rows;
  rows.sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); });
  if (limit) rows = rows.slice(0, limit);
  return ok({ payments: rows });
  })();
}

// ── Cash Drawer ──────────────────────────────────────────────────────────
// A "shift" runs from Start Shift to End Shift. Every cash/card/mobile-money
// sale a cashier rings up while their shift is open is added to the shift's
// running totals automatically (see bumpOpenDrawer, called from sales.gs and
// returns.gs). Ending a shift also snapshots exactly what was sold into
// ShiftSales, so there's a permanent, itemized record of every shift.
function startShift(userId, openingBalance) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_CASHDRAWER);
  var existing = getOpenDrawerRow(userId);
  if (existing) return fail('You already have a shift in progress, started ' + new Date(existing.OpenedAt || existing.Date).toLocaleString() + '.');
  var id = nextId('DRW', SHEETS.CASH_DRAWER, 'DrawerID');
  appendRow(SHEETS.CASH_DRAWER, {
    DrawerID: id, Date: today(), CashierID: userId, OpeningBalance: Number(openingBalance) || 0,
    CashSales: 0, CardSales: 0, MobileMoney: 0, Expenses: 0, ClosingBalance: '', Difference: '', ClosedBy: '',
    OpenedAt: nowIso(), ClosedAt: ''
  });
  logAudit(userId, 'CashDrawer', 'START_SHIFT', id);
  return ok({ drawerId: id });
  })();
}

function endShift(userId, countedCash) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_CASHDRAWER);
  var drawer = getOpenDrawerRow(userId);
  if (!drawer) return fail('No shift is currently open for you.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var expected = Number(drawer.OpeningBalance) + Number(drawer.CashSales) - Number(drawer.Expenses);
    var counted = Number(countedCash);
    var closedAt = nowIso();
    var startTime = new Date(drawer.OpenedAt || drawer.Date);
    var endTime = new Date(closedAt);

    // Snapshot every sale this cashier rang up during the shift window.
    var sales = readTable(SHEETS.SALES).rows.filter(function (s) {
      return s.CashierID === userId && s.Status !== 'Voided' &&
        new Date(s.SaleDate) >= startTime && new Date(s.SaleDate) <= endTime;
    });
    var saleIds = {}; sales.forEach(function (s) { saleIds[s.SaleID] = true; });
    var items = readTable(SHEETS.SALE_ITEMS).rows.filter(function (i) { return saleIds[i.SaleID]; });
    var products = readTable(SHEETS.PRODUCTS).rows;
    var nameById = {}; products.forEach(function (p) { nameById[p.ProductID] = p.ProductName; });

    var totals = {};
    items.forEach(function (i) {
      if (!totals[i.ProductID]) totals[i.ProductID] = { qty: 0, revenue: 0 };
      totals[i.ProductID].qty += Number(i.Quantity);
      totals[i.ProductID].revenue += Number(i.Total);
    });
    var productIds = Object.keys(totals);
    if (productIds.length) {
      appendRows(SHEETS.SHIFT_SALES, productIds.map(function (pid) {
        return {
          ShiftSaleID: Utilities.getUuid(), DrawerID: drawer.DrawerID, CashierID: userId,
          ProductID: pid, ProductName: nameById[pid] || pid,
          QuantitySold: totals[pid].qty, Revenue: round2(totals[pid].revenue)
        };
      }));
    }

    updateRowById(SHEETS.CASH_DRAWER, 'DrawerID', drawer.DrawerID, {
      ClosingBalance: counted, Difference: round2(counted - expected), ClosedBy: userId, ClosedAt: closedAt
    });
    logAudit(userId, 'CashDrawer', 'END_SHIFT', drawer.DrawerID, expected, counted);

    var itemsSold = productIds.map(function (pid) {
      return { productName: nameById[pid] || pid, qty: totals[pid].qty, revenue: round2(totals[pid].revenue) };
    }).sort(function (a, b) { return b.revenue - a.revenue; });

    return ok({
      expected: expected, counted: counted, difference: round2(counted - expected),
      transactionCount: sales.length, itemsSold: itemsSold
    });
  } finally {
    lock.releaseLock();
  }
  })();
}

function getCurrentDrawer(userId) {
  return safe(function () {
  requireUser(userId);
  var drawer = getOpenDrawerRow(userId);
  return ok({ drawer: drawer || null });
  })();
}

function getOpenDrawerRow(userId) {
  return findRows(SHEETS.CASH_DRAWER, function (d) { return d.CashierID === userId && (d.ClosingBalance === '' || d.ClosingBalance === undefined); })[0] || null;
}

// Adds to a cashier's open shift totals as sales/returns happen. Silently
// no-ops if they don't have a shift open (e.g. Owner ringing up a sale
// without using drawer tracking) — sales still succeed either way.
function bumpOpenDrawer(userId, field, amount) {
  var drawer = getOpenDrawerRow(userId);
  if (!drawer) return;
  var current = Number(drawer[field] || 0);
  var updates = {};
  updates[field] = round2(current + amount);
  updateRowById(SHEETS.CASH_DRAWER, 'DrawerID', drawer.DrawerID, updates);
}

// Admin view — every shift, any cashier, most recent first.
function getShiftHistory(userId, limit) {
  return safe(function () {
  authorize(userId, PERMISSIONS.VIEW_REPORTS);
  var users = readTable(SHEETS.USERS).rows;
  var nameById = {}; users.forEach(function (u) { nameById[u.UserID] = u.FullName; });
  var rows = readTable(SHEETS.CASH_DRAWER).rows.filter(function (d) { return d.ClosingBalance !== '' && d.ClosingBalance !== undefined; });
  rows.forEach(function (r) { r.CashierName = nameById[r.CashierID] || r.CashierID; });
  rows.sort(function (a, b) { return new Date(b.ClosedAt || b.Date) - new Date(a.ClosedAt || a.Date); });
  if (limit) rows = rows.slice(0, limit);
  return ok({ shifts: rows });
  })();
}

// A cashier can pull up their own past shift; VIEW_REPORTS (Owner) can pull up any.
function getShiftDetails(userId, drawerId) {
  return safe(function () {
  var user = requireUser(userId);
  var drawer = findRowById(SHEETS.CASH_DRAWER, 'DrawerID', drawerId);
  if (!drawer) return fail('Shift not found.');
  if (drawer.CashierID !== userId && !hasPermission(user.RoleID, PERMISSIONS.VIEW_REPORTS)) {
    return fail('You do not have permission to view this shift.');
  }
  var items = readTable(SHEETS.SHIFT_SALES).rows.filter(function (i) { return i.DrawerID === drawerId; });
  items.sort(function (a, b) { return Number(b.Revenue) - Number(a.Revenue); });
  var users = readTable(SHEETS.USERS).rows;
  var cashier = users.filter(function (u) { return u.UserID === drawer.CashierID; })[0];
  drawer.CashierName = cashier ? cashier.FullName : drawer.CashierID;
  return ok({ drawer: drawer, items: items });
  })();
}
