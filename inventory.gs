// ============================================================================
//  inventory.gs — Products & Stock Movements
//  Rule: stock quantity is NEVER edited directly. Every change goes through
//  recordStockMovement(), so StockMovements is always a full, traceable
//  history of how the current Qty was arrived at.
// ============================================================================

function getProducts(userId) {
  try {
    authorize(userId, 'VIEW_PRODUCTS');
    var table = readTable(SHEETS.PRODUCTS);
    var rows = table.rows.filter(function (r) { return r.Active !== false && r.Active !== 'FALSE'; });
    rows.sort(function (a, b) { return String(a.Name).localeCompare(String(b.Name)); });
    return ok({ products: rows });
  } catch (e) {
    return fail(e.message);
  }
}

function createProduct(userId, product) {
  try {
    authorize(userId, 'CREATE_PRODUCT');
    if (!product.name || product.price === undefined || product.price === '') {
      return fail('Name and price are required.');
    }
    var id = nextId('MED', SHEETS.PRODUCTS, 'ProductID');
    var startQty = Number(product.qty) || 0;

    appendRow(SHEETS.PRODUCTS, {
      ProductID: id,
      Name: product.name,
      Barcode: product.barcode || '',
      Category: product.category || '',
      Unit: product.unit || 'unit',
      Cost: Number(product.cost) || 0,
      Price: Number(product.price),
      Qty: startQty,
      MinQty: Number(product.minQty) || 0,
      Expiry: product.expiry || '',
      Supplier: product.supplier || '',
      Active: true,
      CreatedAt: nowIso(),
      UpdatedAt: nowIso()
    });

    if (startQty > 0) {
      recordStockMovement(id, product.name, 'Initial Stock', startQty, startQty, id, userId, 'Opening balance');
    }
    logAudit(userId, 'CREATE_PRODUCT', 'Added product ' + id + ' (' + product.name + ')');
    return ok({ productId: id });
  } catch (e) {
    return fail(e.message);
  }
}

function updateProduct(userId, product) {
  try {
    authorize(userId, 'EDIT_PRODUCT');
    if (!product.productId) return fail('Missing product ID.');
    var updates = {
      Name: product.name,
      Barcode: product.barcode || '',
      Category: product.category || '',
      Unit: product.unit || 'unit',
      Cost: Number(product.cost) || 0,
      Price: Number(product.price),
      MinQty: Number(product.minQty) || 0,
      Expiry: product.expiry || '',
      Supplier: product.supplier || '',
      UpdatedAt: nowIso()
    };
    var success = updateRowById(SHEETS.PRODUCTS, 'ProductID', product.productId, updates);
    if (!success) return fail('Product not found.');
    logAudit(userId, 'EDIT_PRODUCT', 'Edited product ' + product.productId);
    return ok({});
  } catch (e) {
    return fail(e.message);
  }
}

function deleteProduct(userId, productId) {
  try {
    authorize(userId, 'DELETE_PRODUCT');
    // Soft delete — keeps sales history and audit logs intact.
    var success = updateRowById(SHEETS.PRODUCTS, 'ProductID', productId, { Active: false, UpdatedAt: nowIso() });
    if (!success) return fail('Product not found.');
    logAudit(userId, 'DELETE_PRODUCT', 'Deactivated product ' + productId);
    return ok({});
  } catch (e) {
    return fail(e.message);
  }
}

// type: 'Purchase' | 'Sale' | 'Adjustment' | 'Expired' | 'Returned' | 'Damaged' | 'Initial Stock'
// qtyChange: positive to add stock, negative to remove.
function adjustStock(userId, productId, qtyChange, type, notes) {
  try {
    authorize(userId, 'ADJUST_STOCK');
    var product = findRowById(SHEETS.PRODUCTS, 'ProductID', productId);
    if (!product) return fail('Product not found.');

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var fresh = findRowById(SHEETS.PRODUCTS, 'ProductID', productId);
      var newQty = Number(fresh.Qty) + Number(qtyChange);
      if (newQty < 0) return fail('That would take stock below zero (currently ' + fresh.Qty + ').');

      updateRowById(SHEETS.PRODUCTS, 'ProductID', productId, { Qty: newQty, UpdatedAt: nowIso() });
      recordStockMovement(productId, fresh.Name, type || 'Adjustment', qtyChange, newQty, '', userId, notes || '');
      logAudit(userId, 'ADJUST_STOCK', productId + ' ' + (qtyChange > 0 ? '+' : '') + qtyChange + ' (' + type + ')');
      return ok({ newQty: newQty });
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    return fail(e.message);
  }
}

// Internal — not exposed directly to the client. Always called alongside a
// stock quantity change so movements and current stock never drift apart.
function recordStockMovement(productId, productName, type, qtyChange, resultingQty, refId, userId, notes) {
  appendRow(SHEETS.STOCK_MOVEMENTS, {
    MovementID: Utilities.getUuid(),
    DateTime: nowIso(),
    ProductID: productId,
    ProductName: productName,
    Type: type,
    QtyChange: qtyChange,
    ResultingQty: resultingQty,
    RefID: refId || '',
    UserID: userId,
    Notes: notes || ''
  });
}

function getLowStockProducts(userId) {
  try {
    authorize(userId, 'VIEW_PRODUCTS');
    var table = readTable(SHEETS.PRODUCTS);
    var low = table.rows.filter(function (r) {
      return r.Active !== false && r.Active !== 'FALSE' && Number(r.Qty) <= Number(r.MinQty || 0);
    });
    return ok({ products: low });
  } catch (e) {
    return fail(e.message);
  }
}