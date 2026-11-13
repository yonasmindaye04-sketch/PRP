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

  var storeId = resolveStoreId(options.storeId);
  if (!storeExists(storeId)) return fail('Store not found.');

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
      var inv = findInventoryRow(product.ProductID, storeId);
      var pillsPerUnit = Number(product.PillsPerUnit) || 0;
      var sellByPill = product.SellByPill === true || product.SellByPill === 'TRUE';

      if (sellByPill && pillsPerUnit > 0) {
        var availablePills = (inv ? Number(inv.CurrentStock) : 0) * pillsPerUnit + (inv ? Number(inv.LoosePills) || 0 : 0);
        if (availablePills < qty) return fail('Not enough stock for ' + product.ProductName + ' at ' + storeLabel(storeId) + ' (have ' + availablePills + ' pills, need ' + qty + ').');
      } else {
        var available = inv ? Number(inv.CurrentStock) : 0;
        if (available < qty) return fail('Not enough stock for ' + product.ProductName + ' at ' + storeLabel(storeId) + ' (have ' + available + ', need ' + qty + ').');
      }

      var unitPrice = item.unitPrice !== undefined ? Number(item.unitPrice) : Number(product.SellingPrice);
      var marginUsed = item.marginUsed !== undefined ? Number(item.marginUsed) : 0;
      var lineTax = unitPrice * qty * (Number(product.TaxRate) || 0) / 100;
      var lineTotal = unitPrice * qty + lineTax;
      subtotal += unitPrice * qty;
      totalTax += lineTax;
      lineItems.push({ product: product, qty: qty, unitPrice: unitPrice, marginUsed: marginUsed, tax: lineTax, lineTotal: lineTotal });
    }

    var discount = Number(options.discount) || 0;
    var grandTotal = Math.max(0, subtotal - discount + totalTax);
    var amountReceived = options.amountReceived !== undefined ? Number(options.amountReceived) : grandTotal;
    var saleId = nextId('SALE', SHEETS.SALES, 'SaleID');

    appendRow(SHEETS.SALES, {
      SaleID: saleId, SaleDate: nowIso(), InvoiceNumber: saleId, CustomerID: options.customerId || '',
      CashierID: user.UserID, TotalAmount: subtotal, Discount: discount, Tax: totalTax, GrandTotal: grandTotal,
      PaymentMethod: options.paymentMethod || 'Cash', AmountReceived: amountReceived,
      ChangeGiven: Math.max(0, amountReceived - grandTotal), Status: 'Completed',
      StoreID: storeId
    });

    // Deduct stock FEFO per line, recording which batch(es) supplied it.
    lineItems.forEach(function (li) {
      var pillsPerUnit = Number(li.product.PillsPerUnit) || 0;
      var sellByPill = li.product.SellByPill === true || li.product.SellByPill === 'TRUE';
      var consumed = (sellByPill && pillsPerUnit > 0)
        ? deductPillsFEFO(li.product.ProductID, storeId, li.qty, STOCK_MOVEMENT_TYPES.SALE, 'Sale', saleId, userId, '')
        : deductStockFEFO(li.product.ProductID, storeId, li.qty, STOCK_MOVEMENT_TYPES.SALE, 'Sale', saleId, userId, '');
      consumed.forEach(function (c) {
        appendRow(SHEETS.SALE_ITEMS, {
          SaleItemID: Utilities.getUuid(), SaleID: saleId, ProductID: li.product.ProductID, BatchID: c.batchId,
          Quantity: c.qty, UnitPrice: li.unitPrice, MarginUsed: li.marginUsed,
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

// ============================================================================
//  Sales history — searchable, filterable, paginated.
//
//  filters: {
//    search        : free text over sale id, invoice, customer, cashier and
//                    product names sold in the transaction
//    from, to      : 'YYYY-MM-DD' (inclusive)
//    paymentMethod : Cash | Card | Mobile Money
//    status        : Completed | Voided
//    cashierId     : a single cashier
//    storeId       : a single store
//    minTotal, maxTotal : amount range
//    page, pageSize, sortBy, sortDir
//  }
//
//  A plain number is still accepted as the second argument for backwards
//  compatibility (it is treated as a limit).
// ============================================================================
function getSales(userId, filters, page, pageSize) {
  return safe(function () {
  var user = requireUser(userId);
  var canViewAll = hasPermission(user.RoleID, PERMISSIONS.VIEW_SALES);
  var canViewOwn = hasPermission(user.RoleID, PERMISSIONS.VIEW_OWN_SALES);
  if (!canViewAll && !canViewOwn) return fail('You do not have permission to view sales.');

  // Backwards compatibility: getSales(userId, 100) used to mean "limit 100".
  if (typeof filters === 'number' || typeof filters === 'string') {
    filters = { pageSize: Number(filters) || 100 };
  }
  filters = filters || {};

  var rows = readTable(SHEETS.SALES).rows;
  if (!canViewAll) rows = rows.filter(function (r) { return r.CashierID === userId; });

  var users = readTable(SHEETS.USERS).rows;
  var nameById = {}; users.forEach(function (u) { nameById[u.UserID] = u.FullName || u.Username; });

  var customers = readTable(SHEETS.CUSTOMERS).rows;
  var customerById = {}; customers.forEach(function (c) { customerById[c.CustomerID] = c; });

  var storeNames = getStoreNameMap();

  // Products sold per sale — used by the search box so "paracetamol" finds
  // the transaction that contained it.
  var productNames = {};
  readTable(SHEETS.PRODUCTS).rows.forEach(function (p) { productNames[p.ProductID] = p.ProductName; });
  var itemNamesBySale = {};
  readTable(SHEETS.SALE_ITEMS).rows.forEach(function (item) {
    var name = productNames[item.ProductID] || item.ProductID;
    if (!itemNamesBySale[item.SaleID]) itemNamesBySale[item.SaleID] = [];
    if (itemNamesBySale[item.SaleID].indexOf(name) === -1) itemNamesBySale[item.SaleID].push(name);
  });

  // ── Filters ─────────────────────────────────────────────────────────────
  if (filters.from) {
    var from = parseDateStart(filters.from);
    rows = rows.filter(function (r) { return new Date(r.SaleDate) >= from; });
  }
  if (filters.to) {
    var to = parseDateEnd(filters.to);
    rows = rows.filter(function (r) { return new Date(r.SaleDate) <= to; });
  }
  if (filters.paymentMethod) {
    var pm = String(filters.paymentMethod);
    rows = rows.filter(function (r) { return String(r.PaymentMethod || '') === pm; });
  }
  if (filters.status) {
    var wantedStatus = String(filters.status).toLowerCase();
    rows = rows.filter(function (r) {
      var st = String(r.Status || 'Completed').toLowerCase();
      if (wantedStatus === 'completed') return st !== 'voided' && st !== 'deleted' && st !== 'cancelled';
      return st === wantedStatus;
    });
  }
  if (filters.cashierId) {
    rows = rows.filter(function (r) { return r.CashierID === filters.cashierId; });
  }
  if (filters.storeId) {
    var sid = resolveStoreId(filters.storeId);
    rows = rows.filter(function (r) { return resolveStoreId(r.StoreID) === sid; });
  }
  if (filters.minTotal !== undefined && filters.minTotal !== '') {
    var minT = Number(filters.minTotal);
    rows = rows.filter(function (r) { return Number(r.GrandTotal || 0) >= minT; });
  }
  if (filters.maxTotal !== undefined && filters.maxTotal !== '') {
    var maxT = Number(filters.maxTotal);
    rows = rows.filter(function (r) { return Number(r.GrandTotal || 0) <= maxT; });
  }
  if (filters.search) {
    var q = String(filters.search).trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (r) {
        var cashier = nameById[r.CashierID] || '';
        var customer = customerById[r.CustomerID];
        var customerName = customer ? (customer.FullName || '') : '';
        var phone = customer ? (customer.Phone || '') : '';
        var items = (itemNamesBySale[r.SaleID] || []).join(' ');
        return String(r.SaleID || '').toLowerCase().indexOf(q) > -1 ||
               String(r.InvoiceNumber || '').toLowerCase().indexOf(q) > -1 ||
               String(r.CustomerID || '').toLowerCase().indexOf(q) > -1 ||
               customerName.toLowerCase().indexOf(q) > -1 ||
               phone.toLowerCase().indexOf(q) > -1 ||
               cashier.toLowerCase().indexOf(q) > -1 ||
               items.toLowerCase().indexOf(q) > -1;
      });
    }
  }

  // ── Sort ────────────────────────────────────────────────────────────────
  var sortBy = String(filters.sortBy || 'date');
  var sortDir = String(filters.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  rows.sort(function (a, b) {
    if (sortBy === 'total') return (Number(a.GrandTotal || 0) - Number(b.GrandTotal || 0)) * sortDir;
    return (new Date(a.SaleDate) - new Date(b.SaleDate)) * sortDir;
  });

  // ── Enrich + paginate ───────────────────────────────────────────────────
  var total = rows.length;
  var totalAmount = 0;
  rows.forEach(function (r) {
    r.CashierName = nameById[r.CashierID] || r.CashierID;
    r.StoreName = storeNames[resolveStoreId(r.StoreID)] || storeLabel(r.StoreID);
    r.CustomerName = customerById[r.CustomerID] ? customerById[r.CustomerID].FullName : '';
    r.ItemNames = (itemNamesBySale[r.SaleID] || []).join(', ');
    totalAmount += Number(r.GrandTotal || 0);
  });

  var currentPage = Math.max(1, Number(filters.page) || Number(page) || 1);
  var size = Math.max(1, Math.min(200, Number(filters.pageSize) || Number(pageSize) || 25));
  var pages = Math.max(1, Math.ceil(total / size));
  if (currentPage > pages) currentPage = pages;

  var slice = rows.slice((currentPage - 1) * size, currentPage * size);

  return ok({
    sales: slice,
    total: total,
    page: currentPage,
    pageSize: size,
    pages: pages,
    summary: {
      count: total,
      totalAmount: round2(totalAmount),
      from: filters.from || '',
      to: filters.to || ''
    }
  });
  })();
}

// A lightweight list of cashiers, for the sales history filter dropdown.
function getSalesCashiers(userId) {
  return safe(function () {
    requireUser(userId);
    var cashiers = readTable(SHEETS.USERS).rows.map(function (u) {
      return { UserID: u.UserID, FullName: u.FullName || u.Username, RoleID: u.RoleID };
    });
    cashiers.sort(function (a, b) { return String(a.FullName).localeCompare(String(b.FullName)); });
    return ok({ cashiers: cashiers });
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

  sale.StoreName = storeLabel(sale.StoreID);
  var customer = sale.CustomerID ? findRowById(SHEETS.CUSTOMERS, 'CustomerID', sale.CustomerID) : null;
  sale.CustomerName = customer ? customer.FullName : '';
  var cashier = sale.CashierID ? findRowById(SHEETS.USERS, 'UserID', sale.CashierID) : null;
  sale.CashierName = cashier ? (cashier.FullName || cashier.Username) : sale.CashierID;

  if (sale.DeletedBy) {
    var deleter = findRowById(SHEETS.USERS, 'UserID', sale.DeletedBy);
    sale.DeletedByName = deleter ? (deleter.FullName || deleter.Username) : sale.DeletedBy;
  }
  return ok({ sale: sale, items: items });
  })();
}

function deleteSale(userId, saleId, reason) {
  return safe(function () {
    var user = requireUser(userId);
    var canDelete = (user.RoleID === ROLE_IDS.OWNER) || hasPermission(user.RoleID, PERMISSIONS.REFUND);
    if (!canDelete) return fail('Only the Owner or authorized staff can delete/void a sale.');
    if (!reason || !reason.trim()) return fail('A reason is required to void/delete a sale.');

    var sale = findRowById(SHEETS.SALES, 'SaleID', saleId);
    if (!sale) return fail('Sale not found.');
    if (sale.Status === 'Voided' || sale.Status === 'Deleted') return fail('This sale has already been voided/deleted.');

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var items = findRows(SHEETS.SALE_ITEMS, function (i) { return i.SaleID === saleId; });
      var products = readTable(SHEETS.PRODUCTS).rows;
      var productById = {}; products.forEach(function (p) { productById[p.ProductID] = p; });
      var storeId = resolveStoreId(sale.StoreID);

      items.forEach(function (item) {
        var product = productById[item.ProductID];
        var isPill = product && (product.SellByPill === true || product.SellByPill === 'TRUE');
        var ppu = isPill ? Number(product.PillsPerUnit) || 1 : 1;
        var qty = Number(item.Quantity || 0);
        if (qty <= 0) return;

        if (isPill && ppu > 1) {
          var inv = findInventoryRow(item.ProductID, storeId);
          var currentLoose = inv ? Number(inv.LoosePills || 0) : 0;
          var totalLoose = currentLoose + qty;
          var wholeUnits = Math.floor(totalLoose / ppu);
          var remLoose = totalLoose % ppu;

          if (wholeUnits > 0 && item.BatchID) {
            var batch = findRowById(SHEETS.BATCHES, 'BatchID', item.BatchID);
            if (batch) {
              updateRowById(SHEETS.BATCHES, 'BatchID', item.BatchID, { Quantity: Number(batch.Quantity || 0) + wholeUnits });
            }
          }
          if (inv) {
            updateRowByIndex(SHEETS.INVENTORY, inv._row, { LoosePills: remLoose, LastUpdated: nowIso() });
          }
          recalculateInventory(item.ProductID, storeId, item.BatchID, STOCK_MOVEMENT_TYPES.SALE_VOIDED, qty, 'SaleVoided', saleId, userId,
            'Sale ' + saleId + ' voided: ' + reason);
        } else {
          if (item.BatchID) {
            var batch = findRowById(SHEETS.BATCHES, 'BatchID', item.BatchID);
            if (batch) {
              updateRowById(SHEETS.BATCHES, 'BatchID', item.BatchID, { Quantity: Number(batch.Quantity || 0) + qty });
            }
          }
          recalculateInventory(item.ProductID, storeId, item.BatchID, STOCK_MOVEMENT_TYPES.SALE_VOIDED, qty, 'SaleVoided', saleId, userId,
            'Sale ' + saleId + ' voided: ' + reason);
        }
      });

      var paymentMethod = sale.PaymentMethod || 'Cash';
      var field = paymentMethod === 'Cash' ? 'CashSales' : (paymentMethod === 'Card' ? 'CardSales' : 'MobileMoney');
      bumpOpenDrawer(sale.CashierID, field, -Number(sale.GrandTotal || 0));

      updateRowById(SHEETS.SALES, 'SaleID', saleId, {
        Status: 'Voided',
        DeletedBy: userId,
        DeletedReason: reason.trim(),
        DeletedDate: nowIso()
      });

      logAudit(userId, 'Sales', 'VOID', saleId, { grandTotal: sale.GrandTotal, status: sale.Status }, { status: 'Voided', reason: reason.trim() });
      return ok({});
    } finally {
      lock.releaseLock();
    }
  })();
}