// ============================================================================
//  products.gs — Products, Batches, Inventory rollup
//  Rule: Inventory.CurrentStock is a derived rollup, never edited directly.
//  It's kept in sync every time a batch quantity changes (purchase, sale,
//  return, adjustment) via recalculateInventory(). StockMovements is the
//  append-only ledger that explains every change.
// ============================================================================

// Returns products joined with their live stock and category name — this is
// what both the catalog screen and the POS screen consume.
function getProducts(userId) {
  return safe(function () {
  authorize(userId, PERMISSIONS.VIEW_PRODUCTS);
  var products = readTable(SHEETS.PRODUCTS).rows.filter(function (p) { return p.Active !== false && p.Active !== 'FALSE'; });
  var inventory = readTable(SHEETS.INVENTORY).rows;
  var categories = readTable(SHEETS.CATEGORIES).rows;

  var stockByProduct = {};
  inventory.forEach(function (inv) { stockByProduct[inv.ProductID] = inv; });
  var categoryName = {};
  categories.forEach(function (c) { categoryName[c.CategoryID] = c.CategoryName; });

  var out = products.map(function (p) {
    var inv = stockByProduct[p.ProductID];
    return {
      ProductID: p.ProductID, Barcode: p.Barcode, ProductName: p.ProductName, GenericName: p.GenericName,
      Brand: p.Brand, CategoryID: p.CategoryID, CategoryName: categoryName[p.CategoryID] || '—',
      Unit: p.Unit, Strength: p.Strength, DosageForm: p.DosageForm,
      PurchasePrice: p.PurchasePrice, SellingPrice: p.SellingPrice, TaxRate: p.TaxRate,
      MinimumStock: p.MinimumStock, MaximumStock: p.MaximumStock, ReorderLevel: p.ReorderLevel,
      SupplierID: p.SupplierID,
      CurrentStock: inv ? Number(inv.CurrentStock) : 0,
      AvailableStock: inv ? Number(inv.AvailableStock) : 0
    };
  });
  out.sort(function (a, b) { return String(a.ProductName).localeCompare(String(b.ProductName)); });
  return ok({ products: out });
  })();
}

function createProduct(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.CREATE_PRODUCT);
  if (!input.productName || input.sellingPrice === undefined || input.sellingPrice === '') {
    return fail('Product name and selling price are required.');
  }
  var id = nextId('MED', SHEETS.PRODUCTS, 'ProductID');
  appendRow(SHEETS.PRODUCTS, {
    ProductID: id, Barcode: input.barcode || '', ProductName: input.productName, GenericName: input.genericName || '',
    Brand: input.brand || '', CategoryID: input.categoryId || '', Unit: input.unit || 'unit',
    Strength: input.strength || '', DosageForm: input.dosageForm || '',
    PurchasePrice: Number(input.purchasePrice) || 0, SellingPrice: Number(input.sellingPrice),
    TaxRate: Number(input.taxRate) || 0, MinimumStock: Number(input.minimumStock) || 0,
    MaximumStock: Number(input.maximumStock) || 0, ReorderLevel: Number(input.reorderLevel) || 0,
    SupplierID: input.supplierId || '', Active: true, CreatedDate: nowIso(), UpdatedDate: nowIso(), CreatedBy: userId
  });

  // Inventory row starts at zero — stock only enters through a Purchase or
  // an opening-balance batch (see receivePurchase / addOpeningBatch).
  appendRow(SHEETS.INVENTORY, { ProductID: id, CurrentStock: 0, ReservedStock: 0, AvailableStock: 0, LastUpdated: nowIso() });

  var openingQty = Number(input.openingStock) || 0;
  if (openingQty > 0) {
    addOpeningBatch(id, openingQty, Number(input.purchasePrice) || 0, Number(input.sellingPrice), input.expiryDate || '', userId);
  }

  logAudit(userId, 'Products', 'CREATE', id, null, input.productName);
  return ok({ productId: id });
  })();
}

function updateProduct(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.EDIT_PRODUCT);
  if (!input.productId) return fail('Missing product ID.');
  var updates = {
    Barcode: input.barcode || '', ProductName: input.productName, GenericName: input.genericName || '',
    Brand: input.brand || '', CategoryID: input.categoryId || '', Unit: input.unit || 'unit',
    Strength: input.strength || '', DosageForm: input.dosageForm || '',
    PurchasePrice: Number(input.purchasePrice) || 0, SellingPrice: Number(input.sellingPrice),
    TaxRate: Number(input.taxRate) || 0, MinimumStock: Number(input.minimumStock) || 0,
    MaximumStock: Number(input.maximumStock) || 0, ReorderLevel: Number(input.reorderLevel) || 0,
    SupplierID: input.supplierId || '', UpdatedDate: nowIso()
  };
  if (!updateRowById(SHEETS.PRODUCTS, 'ProductID', input.productId, updates)) return fail('Product not found.');
  logAudit(userId, 'Products', 'UPDATE', input.productId);
  return ok({});
  })();
}

function deleteProduct(userId, productId) {
  return safe(function () {
  authorize(userId, PERMISSIONS.DELETE_PRODUCT);
  updateRowById(SHEETS.PRODUCTS, 'ProductID', productId, { Active: false, UpdatedDate: nowIso() });
  logAudit(userId, 'Products', 'DEACTIVATE', productId);
  return ok({});
  })();
}

function getLowStockProducts(userId) {
  return safe(function () {
  authorize(userId, PERMISSIONS.VIEW_PRODUCTS);
  var res = getProducts(userId);
  if (!res.success) return res;
  var low = res.products.filter(function (p) { return p.CurrentStock <= Number(p.ReorderLevel || 0); });
  return ok({ products: low });
  })();
}

function getExpiringBatches(userId, withinDays) {
  return safe(function () {
  authorize(userId, PERMISSIONS.VIEW_PRODUCTS);
  var days = Number(withinDays) || 90;
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() + days);
  var products = readTable(SHEETS.PRODUCTS).rows;
  var nameById = {}; products.forEach(function (p) { nameById[p.ProductID] = p.ProductName; });

  var batches = readTable(SHEETS.BATCHES).rows.filter(function (b) {
    return Number(b.Quantity) > 0 && b.ExpiryDate && new Date(b.ExpiryDate) <= cutoff;
  });
  batches.sort(function (a, b) { return new Date(a.ExpiryDate) - new Date(b.ExpiryDate); });
  batches.forEach(function (b) { b.ProductName = nameById[b.ProductID] || b.ProductID; });
  return ok({ batches: batches });
  })();
}

// ── Batches (internal helpers — not called directly by the frontend) ─────

// Adds stock as a new batch and recalculates the Inventory rollup + logs
// the movement. Used by receivePurchase(), opening stock, and returns.
function receiveBatch(productId, qty, purchasePrice, sellingPrice, expiryDate, supplierId, refType, refId, userId, notes) {
  var batchId = nextId('BAT', SHEETS.BATCHES, 'BatchID');
  appendRow(SHEETS.BATCHES, {
    BatchID: batchId, ProductID: productId, BatchNumber: batchId,
    ManufacturingDate: '', ExpiryDate: expiryDate || '', Quantity: qty,
    PurchasePrice: purchasePrice || 0, SellingPrice: sellingPrice || 0, SupplierID: supplierId || ''
  });
  recalculateInventory(productId, batchId, 'Purchase', qty, refType, refId, userId, notes);
  return batchId;
}

function addOpeningBatch(productId, qty, purchasePrice, sellingPrice, expiryDate, userId) {
  return receiveBatch(productId, qty, purchasePrice, sellingPrice, expiryDate, '', 'OpeningStock', productId, userId, 'Opening balance');
}

// Recomputes Inventory.CurrentStock/AvailableStock from the Batches table
// (source of truth = sum of batch quantities) and writes one StockMovements
// row describing the change that triggered the recalc.
function recalculateInventory(productId, batchId, type, qtyChange, refType, refId, userId, notes) {
  var batches = readTable(SHEETS.BATCHES).rows.filter(function (b) { return b.ProductID === productId; });
  var total = batches.reduce(function (sum, b) { return sum + Number(b.Quantity || 0); }, 0);

  var inv = findRowById(SHEETS.INVENTORY, 'ProductID', productId);
  var previousStock = inv ? Number(inv.CurrentStock) : 0;
  if (inv) {
    updateRowById(SHEETS.INVENTORY, 'ProductID', productId, { CurrentStock: total, AvailableStock: total, LastUpdated: nowIso() });
  } else {
    appendRow(SHEETS.INVENTORY, { ProductID: productId, CurrentStock: total, ReservedStock: 0, AvailableStock: total, LastUpdated: nowIso() });
  }

  var product = findRowById(SHEETS.PRODUCTS, 'ProductID', productId);
  appendRow(SHEETS.STOCK_MOVEMENTS, {
    MovementID: Utilities.getUuid(), Date: nowIso(), ProductID: productId, BatchID: batchId || '',
    Type: type, Quantity: qtyChange, PreviousStock: previousStock, NewStock: total,
    ReferenceType: refType || '', ReferenceID: refId || '', Remarks: notes || '', UserID: userId
  });
}

// Deducts `qty` units of a product using FEFO (first-expire-first-out)
// across as many batches as needed. Returns the list of {batchId, qty}
// consumed, or throws if there isn't enough stock.
function deductStockFEFO(productId, qty, type, refType, refId, userId, notes) {
  var batches = readTable(SHEETS.BATCHES).rows.filter(function (b) { return b.ProductID === productId && Number(b.Quantity) > 0; });
  batches.sort(function (a, b) {
    var ae = a.ExpiryDate ? new Date(a.ExpiryDate) : new Date('2999-12-31');
    var be = b.ExpiryDate ? new Date(b.ExpiryDate) : new Date('2999-12-31');
    return ae - be;
  });

  var remaining = qty;
  var consumed = [];
  for (var i = 0; i < batches.length && remaining > 0; i++) {
    var batch = batches[i];
    var take = Math.min(Number(batch.Quantity), remaining);
    if (take <= 0) continue;
    updateRowById(SHEETS.BATCHES, 'BatchID', batch.BatchID, { Quantity: Number(batch.Quantity) - take });
    consumed.push({ batchId: batch.BatchID, qty: take, unitCost: Number(batch.PurchasePrice || 0) });
    remaining -= take;
  }
  if (remaining > 0) throw new Error('Not enough stock available.');

  recalculateInventory(productId, consumed.length ? consumed[0].batchId : '', type, -qty, refType, refId, userId, notes);
  return consumed;
}
