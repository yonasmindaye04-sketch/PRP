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
      PaidAmount: paidAmount, Balance: grandTotal - paidAmount, ReceivedBy: userId, Notes: input.notes || '',
      RecordStatus: 'Active', DeletedBy: '', DeletedReason: '', DeletedDate: ''
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

  var products = readTable(SHEETS.PRODUCTS).rows;
  var productById = {}; products.forEach(function (p) { productById[p.ProductID] = p; });
  var batches = readTable(SHEETS.BATCHES).rows;
  var batchById = {}; batches.forEach(function (b) { batchById[b.BatchID] = b; });

  items.forEach(function (item) {
    var product = productById[item.ProductID] || {};
    var batch = batchById[item.BatchID];
    item.ProductName = product.ProductName || item.ProductID;
    item.GenericName = product.GenericName || '';
    item.Strength = product.Strength || '';
    item.DosageForm = product.DosageForm || '';
    item.Unit = product.Unit || '';
    item.ExpiryDate = batch ? batch.ExpiryDate : '';
    item.BatchNumber = batch ? batch.BatchNumber : item.BatchID;
  });

  var supplier = findRowById(SHEETS.SUPPLIERS, 'SupplierID', purchase.SupplierID);
  var receiver = findRowById(SHEETS.USERS, 'UserID', purchase.ReceivedBy);
  purchase.SupplierName = supplier ? supplier.SupplierName : purchase.SupplierID;
  purchase.ReceivedByName = receiver ? receiver.FullName : purchase.ReceivedBy;
  if (supplier) {
    purchase.SupplierPhone = supplier.Phone || '';
    purchase.SupplierEmail = supplier.Email || '';
    purchase.SupplierAddress = supplier.Address || '';
    purchase.SupplierTaxNumber = supplier.TaxNumber || '';
    purchase.SupplierPaymentTerms = supplier.PaymentTerms || '';
  }
  if (purchase.DeletedBy) {
    var deleter = findRowById(SHEETS.USERS, 'UserID', purchase.DeletedBy);
    purchase.DeletedByName = deleter ? deleter.FullName : purchase.DeletedBy;
  }

  var payments = findRows(SHEETS.PAYMENTS, function (p) { return p.PurchaseID === purchaseId; });
  if (payments.length) {
    var pUsers = readTable(SHEETS.USERS).rows;
    var pNameById = {}; pUsers.forEach(function (u) { pNameById[u.UserID] = u.FullName; });
    payments.forEach(function (p) { p.ReceivedByName = pNameById[p.ReceivedBy] || p.ReceivedBy; });
  }

  return ok({ purchase: purchase, items: items, payments: payments || [] });
  })();
}

// Deleting a purchase is an Owner-only action, checked directly against the
// user's role rather than the RolePermissions sheet — this is deliberately
// not configurable, since voiding a financial record shouldn't depend on
// how someone has set up the permissions table.
function deletePurchase(userId, purchaseId, reason) {
  return safe(function () {
  var user = requireUser(userId);
  if (user.RoleID !== ROLE_IDS.OWNER) return fail('Only the Owner can delete a purchase.');
  if (!reason || !reason.trim()) return fail('A reason is required to delete a purchase.');

  var purchase = findRowById(SHEETS.PURCHASES, 'PurchaseID', purchaseId);
  if (!purchase) return fail('Purchase not found.');
  if (purchase.RecordStatus === 'Deleted') return fail('This purchase has already been deleted.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var items = findRows(SHEETS.PURCHASE_ITEMS, function (i) { return i.PurchaseID === purchaseId; });
    var partialReversalProducts = [];

    items.forEach(function (item) {
      var batch = findRowById(SHEETS.BATCHES, 'BatchID', item.BatchID);
      if (!batch) return; // batch already fully removed some other way — nothing to reverse
      var purchasedQty = Number(item.Quantity);
      var currentQty = Number(batch.Quantity);
      var reduceBy = Math.min(purchasedQty, currentQty);
      if (reduceBy <= 0) return;

      updateRowById(SHEETS.BATCHES, 'BatchID', batch.BatchID, { Quantity: currentQty - reduceBy });
      recalculateInventory(item.ProductID, batch.BatchID, 'Purchase Deleted', -reduceBy, 'PurchaseDeleted', purchaseId, userId,
        'Purchase ' + purchaseId + ' deleted: ' + reason);

      if (reduceBy < purchasedQty) {
        // Some of this batch was already sold — that portion can't be
        // "unreceived", so stock only reverses down to what's left.
        partialReversalProducts.push(item.ProductID);
      }
    });

    // Cancel whatever unpaid balance this purchase still contributed —
    // payments already made are real money that changed hands and are
    // left alone; only the outstanding portion is removed.
    adjustSupplierBalance(purchase.SupplierID, -Number(purchase.Balance || 0));

    updateRowById(SHEETS.PURCHASES, 'PurchaseID', purchaseId, {
      RecordStatus: 'Deleted', DeletedBy: userId, DeletedReason: reason, DeletedDate: nowIso()
    });

    logAudit(userId, 'Purchases', 'DELETE', purchaseId, purchase, { reason: reason });

    return ok({
      partialReversal: partialReversalProducts.length > 0,
      affectedProductCount: partialReversalProducts.length
    });
  } finally {
    lock.releaseLock();
  }
  })();
}