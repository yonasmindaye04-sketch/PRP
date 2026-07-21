// ============================================================================
//  purchases.gs — Purchases & PurchaseItems
//  A purchase invoice creates one Batches row per line (so each delivery's
//  cost/expiry is tracked separately), logs a StockMovements row via
//  receiveBatch(), and updates the supplier's running balance.
// ============================================================================

// items: [{ productId, quantity, purchasePrice, sellingPrice, expiryDate }]
function createPurchase(userId, input) {
  return safe(function () {
  var user = authorize(userId, PERMISSIONS.MANAGE_PURCHASES);
  if (!input.supplierId) return fail('Select a supplier.');
  if (!input.items || !input.items.length) return fail('Add at least one line item.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var products = readTable(SHEETS.PRODUCTS).rows;
    var byId = {}; products.forEach(function (p) { byId[p.ProductID] = p; });

    var subtotal = 0;
    var validated = [];
    for (var i = 0; i < input.items.length; i++) {
      var it = input.items[i];
      var product = byId[it.productId];
      if (!product) return fail('Unknown product in line ' + (i + 1) + '.');
      var qty = Number(it.quantity);
      var price = Number(it.purchasePrice);
      if (qty <= 0 || price < 0) return fail('Invalid quantity/price in line ' + (i + 1) + '.');
      var lineTotal = qty * price;
      subtotal += lineTotal;
      validated.push({ product: product, qty: qty, purchasePrice: price, sellingPrice: Number(it.sellingPrice) || Number(product.SellingPrice), expiryDate: it.expiryDate || '', lineTotal: lineTotal });
    }

    var discount = Number(input.discount) || 0;
    var tax = Number(input.tax) || 0;
    var grandTotal = subtotal - discount + tax;
    var paidAmount = Number(input.paidAmount) || 0;
    var purchaseId = nextId('PUR', SHEETS.PURCHASES, 'PurchaseID');

    appendRow(SHEETS.PURCHASES, {
      PurchaseID: purchaseId, PurchaseDate: nowIso(), SupplierID: input.supplierId,
      InvoiceNumber: input.invoiceNumber || '', TotalAmount: subtotal, Discount: discount, Tax: tax,
      GrandTotal: grandTotal, PaymentStatus: paidAmount >= grandTotal ? 'Paid' : (paidAmount > 0 ? 'Partial' : 'Unpaid'),
      PaidAmount: paidAmount, Balance: grandTotal - paidAmount, ReceivedBy: userId, Notes: input.notes || ''
    });

    validated.forEach(function (v) {
      var batchId = receiveBatch(v.product.ProductID, v.qty, v.purchasePrice, v.sellingPrice, v.expiryDate, input.supplierId, 'Purchase', purchaseId, userId, '');
      appendRow(SHEETS.PURCHASE_ITEMS, {
        PurchaseItemID: Utilities.getUuid(), PurchaseID: purchaseId, ProductID: v.product.ProductID, BatchID: batchId,
        Quantity: v.qty, PurchasePrice: v.purchasePrice, SellingPrice: v.sellingPrice, Total: v.lineTotal
      });
    });

    // Whatever isn't paid up front increases what we owe the supplier.
    adjustSupplierBalance(input.supplierId, grandTotal - paidAmount);

    logAudit(userId, 'Purchases', 'CREATE', purchaseId, null, grandTotal);
    return ok({ purchaseId: purchaseId, grandTotal: grandTotal });
  } finally {
    lock.releaseLock();
  }
  })();
}

function getPurchases(userId, limit) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_PURCHASES);
  var suppliers = readTable(SHEETS.SUPPLIERS).rows;
  var nameById = {}; suppliers.forEach(function (s) { nameById[s.SupplierID] = s.SupplierName; });
  var rows = readTable(SHEETS.PURCHASES).rows;
  rows.forEach(function (r) { r.SupplierName = nameById[r.SupplierID] || r.SupplierID; });
  rows.sort(function (a, b) { return new Date(b.PurchaseDate) - new Date(a.PurchaseDate); });
  if (limit) rows = rows.slice(0, limit);
  return ok({ purchases: rows });
  })();
}

function getPurchaseDetails(userId, purchaseId) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_PURCHASES);
  var purchase = findRowById(SHEETS.PURCHASES, 'PurchaseID', purchaseId);
  if (!purchase) return fail('Purchase not found.');
  var items = findRows(SHEETS.PURCHASE_ITEMS, function (i) { return i.PurchaseID === purchaseId; });
  return ok({ purchase: purchase, items: items });
  })();
}
