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
  var id = nextId('PAY', SHEETS.PAYMENTS, 'PaymentID');
  appendRow(SHEETS.PAYMENTS, {
    PaymentID: id, Date: nowIso(), SupplierID: input.supplierId, PurchaseID: input.purchaseId || '',
    Amount: Number(input.amount), Method: input.method || 'Cash', Reference: input.reference || '', ReceivedBy: userId
  });
  adjustSupplierBalance(input.supplierId, -Number(input.amount));
  if (input.purchaseId) {
    var purchase = findRowById(SHEETS.PURCHASES, 'PurchaseID', input.purchaseId);
    if (purchase) {
      var newPaid = Number(purchase.PaidAmount || 0) + Number(input.amount);
      var newBalance = Number(purchase.GrandTotal) - newPaid;
      updateRowById(SHEETS.PURCHASES, 'PurchaseID', input.purchaseId, {
        PaidAmount: newPaid, Balance: newBalance, PaymentStatus: newBalance <= 0 ? 'Paid' : 'Partial'
      });
    }
  }
  logAudit(userId, 'Payments', 'CREATE', id, null, input.amount);
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
function openDrawer(userId, openingBalance) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_CASHDRAWER);
  var existing = getOpenDrawerRow(userId);
  if (existing) return fail('You already have an open shift from ' + existing.Date + '.');
  var id = nextId('DRW', SHEETS.CASH_DRAWER, 'DrawerID');
  appendRow(SHEETS.CASH_DRAWER, {
    DrawerID: id, Date: today(), CashierID: userId, OpeningBalance: Number(openingBalance) || 0,
    CashSales: 0, CardSales: 0, MobileMoney: 0, Expenses: 0, ClosingBalance: '', Difference: '', ClosedBy: ''
  });
  logAudit(userId, 'CashDrawer', 'OPEN', id);
  return ok({ drawerId: id });
  })();
}

function closeDrawer(userId, countedCash) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_CASHDRAWER);
  var drawer = getOpenDrawerRow(userId);
  if (!drawer) return fail('No open shift to close.');
  var expected = Number(drawer.OpeningBalance) + Number(drawer.CashSales) - Number(drawer.Expenses);
  var counted = Number(countedCash);
  updateRowById(SHEETS.CASH_DRAWER, 'DrawerID', drawer.DrawerID, {
    ClosingBalance: counted, Difference: round2(counted - expected), ClosedBy: userId
  });
  logAudit(userId, 'CashDrawer', 'CLOSE', drawer.DrawerID, expected, counted);
  return ok({ expected: expected, counted: counted, difference: round2(counted - expected) });
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
