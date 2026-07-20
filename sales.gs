// ============================================================================
//  sales.gs — Point of Sale
//  Deducts stock FEFO (first-expire-first-out) across batches, records which
//  BatchID supplied each unit sold (so a recalled batch is traceable to the
//  exact sale), and feeds the cashier's open CashDrawer shift.
// ============================================================================

// cart: [{ productId, qty }]
function createSale(userId, cart, options) {
  return safe(function () {
  var user = authorize(userId, PERMISSIONS.SELL);
  if (!cart || !cart.length) return fail('Cart is empty.');
  options = options || {};

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var products = readTable(SHEETS.PRODUCTS).rows;
    var byId = {}; products.forEach(function (p) { byId[p.ProductID] = p; });

    var lineItems = [];
    var subtotal = 0, totalTax = 0;

    // Validate the whole cart before writing anything.
    for (var i = 0; i < cart.length; i++) {
      var item = cart[i];
      var product = byId[item.productId];
      if (!product) return fail('Product ' + item.productId + ' not found.');
      var qty = Number(item.qty);
      if (qty <= 0) return fail('Invalid quantity for ' + product.ProductName + '.');
      var inv = findRowById(SHEETS.INVENTORY, 'ProductID', product.ProductID);
      var available = inv ? Number(inv.CurrentStock) : 0;
      if (available < qty) return fail('Not enough stock for ' + product.ProductName + ' (have ' + available + ', need ' + qty + ').');

      var unitPrice = Number(product.SellingPrice);
      var lineTax = unitPrice * qty * (Number(product.TaxRate) || 0) / 100;
      var lineTotal = unitPrice * qty + lineTax;
      subtotal += unitPrice * qty;
      totalTax += lineTax;
      lineItems.push({ product: product, qty: qty, unitPrice: unitPrice, tax: lineTax, lineTotal: lineTotal });
    }

    var discount = Number(options.discount) || 0;
    var grandTotal = Math.max(0, subtotal - discount + totalTax);
    var amountReceived = options.amountReceived !== undefined ? Number(options.amountReceived) : grandTotal;
    var saleId = nextId('SALE', SHEETS.SALES, 'SaleID');

    appendRow(SHEETS.SALES, {
      SaleID: saleId, SaleDate: nowIso(), InvoiceNumber: saleId, CustomerID: options.customerId || '',
      CashierID: user.UserID, TotalAmount: subtotal, Discount: discount, Tax: totalTax, GrandTotal: grandTotal,
      PaymentMethod: options.paymentMethod || 'Cash', AmountReceived: amountReceived,
      ChangeGiven: Math.max(0, amountReceived - grandTotal), Status: 'Completed'
    });

    // Deduct stock FEFO per line, recording which batch(es) supplied it.
    lineItems.forEach(function (li) {
      var consumed = deductStockFEFO(li.product.ProductID, li.qty, 'Sale', 'Sale', saleId, userId, '');
      consumed.forEach(function (c) {
        appendRow(SHEETS.SALE_ITEMS, {
          SaleItemID: Utilities.getUuid(), SaleID: saleId, ProductID: li.product.ProductID, BatchID: c.batchId,
          Quantity: c.qty, UnitPrice: li.unitPrice,
          Discount: discount > 0 ? round2(discount * (c.qty / li.qty) * (li.qty / cartTotalQty(cart))) : 0,
          Tax: round2(li.tax * (c.qty / li.qty)), Total: round2(li.unitPrice * c.qty + li.tax * (c.qty / li.qty))
        });
      });
    });

    if (options.paymentMethod === 'Cash' || !options.paymentMethod) {
      bumpOpenDrawer(user.UserID, 'CashSales', grandTotal);
    } else if (options.paymentMethod === 'Card') {
      bumpOpenDrawer(user.UserID, 'CardSales', grandTotal);
    } else if (options.paymentMethod === 'Mobile Money') {
      bumpOpenDrawer(user.UserID, 'MobileMoney', grandTotal);
    }

    logAudit(userId, 'Sales', 'CREATE', saleId, null, grandTotal);
    return ok({ saleId: saleId, subtotal: subtotal, tax: totalTax, discount: discount, total: grandTotal, change: Math.max(0, amountReceived - grandTotal) });
  } finally {
    lock.releaseLock();
  }
  })();
}

function cartTotalQty(cart) {
  return cart.reduce(function (s, c) { return s + Number(c.qty); }, 0) || 1;
}
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

function getSales(userId, limit) {
  return safe(function () {
  var user = requireUser(userId);
  var canViewAll = hasPermission(user.RoleID, PERMISSIONS.VIEW_SALES);
  var canViewOwn = hasPermission(user.RoleID, PERMISSIONS.VIEW_OWN_SALES);
  if (!canViewAll && !canViewOwn) return fail('You do not have permission to view sales.');

  var rows = readTable(SHEETS.SALES).rows;
  if (!canViewAll) rows = rows.filter(function (r) { return r.CashierID === userId; });
  rows.sort(function (a, b) { return new Date(b.SaleDate) - new Date(a.SaleDate); });
  if (limit) rows = rows.slice(0, limit);

  var users = readTable(SHEETS.USERS).rows;
  var nameById = {}; users.forEach(function (u) { nameById[u.UserID] = u.FullName; });
  rows.forEach(function (r) { r.CashierName = nameById[r.CashierID] || r.CashierID; });

  return ok({ sales: rows });
  })();
}

function getSaleDetails(userId, saleId) {
  return safe(function () {
  requireUser(userId);
  var sale = findRowById(SHEETS.SALES, 'SaleID', saleId);
  if (!sale) return fail('Sale not found.');
  var items = findRows(SHEETS.SALE_ITEMS, function (i) { return i.SaleID === saleId; });
  var products = readTable(SHEETS.PRODUCTS).rows;
  var nameById = {}; products.forEach(function (p) { nameById[p.ProductID] = p.ProductName; });
  items.forEach(function (i) { i.ProductName = nameById[i.ProductID] || i.ProductID; });
  return ok({ sale: sale, items: items });
  })();
}