// ============================================================================
//  products.gs — Products, Batches, Inventory rollup, Stock Movements
//  Rule: Inventory.CurrentStock is a derived rollup, never edited directly.
//  It's kept in sync every time a batch quantity changes (purchase, sale,
//  return, adjustment, transfer) via recalculateInventory(). StockMovements is
//  the append-only ledger that explains every change.
//
//  Every quantity change is scoped to a STORE, so the same product can be
//  held by several branches at the same time.
// ============================================================================

// ── Inventory lookup helpers ───────────────────────────────────────────────

// The Inventory row for a product INSIDE a store. Blank store id => default.
function findInventoryRow(productId, storeId) {
  var sid = resolveStoreId(storeId);
  var rows = readTable(SHEETS.INVENTORY).rows.filter(function (r) {
    return String(r.ProductID) === String(productId);
  });
  for (var i = 0; i < rows.length; i++) {
    if (resolveStoreId(rows[i].StoreID) === sid) return rows[i];
  }
  return null;
}

// Every Inventory row belonging to a product (one per store it sits in).
function findInventoryRows(productId) {
  return readTable(SHEETS.INVENTORY).rows.filter(function (r) {
    return String(r.ProductID) === String(productId);
  });
}

// Aggregated stock for a product across every store.
function totalStockForProduct(productId) {
  return findInventoryRows(productId).reduce(function (sum, inv) {
    return sum + (Number(inv.CurrentStock) || 0);
  }, 0);
}

// Returns products joined with their live stock and category name — this is
// what both the catalog screen and the POS screen consume.
//
// storeId: when supplied, stock is scoped to that store. When omitted, the
// figures are the sum across every store (the "All stores" view).
function getProducts(userId, storeId) {
  return safe(function () {
  authorize(userId, PERMISSIONS.VIEW_PRODUCTS);
  var scoped = (storeId !== undefined && storeId !== null && String(storeId) !== '') ? resolveStoreId(storeId) : '';

  var products = readTable(SHEETS.PRODUCTS).rows.filter(function (p) { return p.Active !== false && p.Active !== 'FALSE'; });
  var inventory = readTable(SHEETS.INVENTORY).rows;
  var categories = readTable(SHEETS.CATEGORIES).rows;

  // productId -> { storeId -> row }
  var stockByProduct = {};
  inventory.forEach(function (inv) {
    var pid = inv.ProductID;
    if (!stockByProduct[pid]) stockByProduct[pid] = {};
    stockByProduct[pid][resolveStoreId(inv.StoreID)] = inv;
  });
  var categoryName = {};
  categories.forEach(function (c) { categoryName[c.CategoryID] = c.CategoryName; });

  var out = products.map(function (p) {
    var perStore = stockByProduct[p.ProductID] || {};
    var inv = scoped ? perStore[scoped] : null;

    var currentStock = 0, loosePills = 0, loosePillsBatchID = '', availableStock = 0;
    if (scoped) {
      if (inv) {
        currentStock = Number(inv.CurrentStock) || 0;
        loosePills = Number(inv.LoosePills) || 0;
        loosePillsBatchID = inv.LoosePillsBatchID || '';
        availableStock = Number(inv.AvailableStock) || 0;
      }
    } else {
      Object.keys(perStore).forEach(function (sid) {
        var row = perStore[sid];
        currentStock += Number(row.CurrentStock) || 0;
        loosePills += Number(row.LoosePills) || 0;
        availableStock += Number(row.AvailableStock) || 0;
      });
    }

    var pillsPerUnit = Number(p.PillsPerUnit) || 0;
    var sellByPill = p.SellByPill === true || p.SellByPill === 'TRUE';
    var displayStock = sellByPill && pillsPerUnit > 0
      ? currentStock * pillsPerUnit + loosePills
      : currentStock;

    return {
      ProductID: p.ProductID, Barcode: p.Barcode, ProductName: p.ProductName, GenericName: p.GenericName,
      Brand: p.Brand, CategoryID: p.CategoryID, CategoryName: categoryName[p.CategoryID] || '—',
      Unit: p.Unit, Strength: p.Strength, DosageForm: p.DosageForm,
      PurchasePrice: p.PurchasePrice, SellingPrice: p.SellingPrice, TaxRate: p.TaxRate,
      DefaultMargin: Number(p.DefaultMargin) || 0,
      PillsPerUnit: pillsPerUnit, SellByPill: sellByPill,
      MinimumStock: p.MinimumStock, MaximumStock: p.MaximumStock, ReorderLevel: p.ReorderLevel,
      SupplierID: p.SupplierID, StoreID: p.StoreID || '',
      CurrentStock: currentStock, LoosePills: loosePills,
      LoosePillsBatchID: loosePillsBatchID,
      AvailableStock: availableStock,
      DisplayStock: displayStock
    };
  });
  out.sort(function (a, b) { return String(a.ProductName).localeCompare(String(b.ProductName)); });
  return ok({ products: out, storeId: scoped });
  })();
}

function createProduct(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.CREATE_PRODUCT);
  if (!input.productName || input.sellingPrice === undefined || input.sellingPrice === '') {
    return fail('Product name and selling price are required.');
  }
  var storeId = resolveStoreId(input.storeId);
  var id = nextId('MED', SHEETS.PRODUCTS, 'ProductID');
  appendRow(SHEETS.PRODUCTS, {
    ProductID: id, Barcode: input.barcode || '', ProductName: input.productName, GenericName: input.genericName || '',
    Brand: input.brand || '', CategoryID: input.categoryId || '', Unit: input.unit || 'unit',
    Strength: input.strength || '', DosageForm: input.dosageForm || '',
    PurchasePrice: Number(input.purchasePrice) || 0, SellingPrice: Number(input.sellingPrice),
    TaxRate: Number(input.taxRate) || 0, DefaultMargin: Number(input.defaultMargin) || 0,
    PillsPerUnit: Number(input.pillsPerUnit) || 0, SellByPill: input.sellByPill || false,
    MinimumStock: Number(input.minimumStock) || 0,
    MaximumStock: Number(input.maximumStock) || 0, ReorderLevel: Number(input.reorderLevel) || 0,
    SupplierID: input.supplierId || '', Active: true, CreatedDate: nowIso(), UpdatedDate: nowIso(),
    CreatedBy: userId, StoreID: storeId
  });

  // Inventory row starts at zero — stock only enters through a Purchase or
  // an opening-balance batch (see receivePurchase / addOpeningBatch).
  appendRow(SHEETS.INVENTORY, { ProductID: id, CurrentStock: 0, LoosePills: 0, LoosePillsBatchID: '', ReservedStock: 0, AvailableStock: 0, LastUpdated: nowIso(), StoreID: storeId });

  var openingQty = Number(input.openingStock) || 0;
  if (openingQty > 0) {
    addOpeningBatch(id, openingQty, Number(input.purchasePrice) || 0, Number(input.sellingPrice), input.expiryDate || '', userId, storeId);
  }

  logAudit(userId, 'Products', 'CREATE', id, null, input.productName);
  return ok({ productId: id, storeId: storeId });
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
    TaxRate: Number(input.taxRate) || 0, DefaultMargin: Number(input.defaultMargin) || 0,
    PillsPerUnit: Number(input.pillsPerUnit) || 0, SellByPill: input.sellByPill || false,
    MinimumStock: Number(input.minimumStock) || 0,
    MaximumStock: Number(input.maximumStock) || 0, ReorderLevel: Number(input.reorderLevel) || 0,
    SupplierID: input.supplierId || '', UpdatedDate: nowIso()
  };
  // The product's home store is only changed when the caller explicitly
  // sends a different one — otherwise it stays where it was.
  if (input.storeId) updates.StoreID = resolveStoreId(input.storeId);
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

// Products at or below their reorder level (per-product level, falling back
// to the global threshold). Scoped to a store when one is given.
function getLowStockProducts(userId, storeId) {
  return safe(function () {
  authorize(userId, PERMISSIONS.VIEW_PRODUCTS);
  var scoped = (storeId !== undefined && storeId !== null && String(storeId) !== '') ? resolveStoreId(storeId) : '';
  var res = getProducts(userId, scoped);
  if (!res.success) return res;
  var settings = getSettingsMap();
  var defaultLowStock = Number(settings.LowStockAlertThreshold || 0);
  var low = res.products.filter(function (p) {
    var threshold = (p.ReorderLevel !== undefined && p.ReorderLevel !== '' && Number(p.ReorderLevel) > 0) ? Number(p.ReorderLevel) : defaultLowStock;
    return p.CurrentStock <= threshold;
  });
  // Sort by hierarchy: Out of stock (CurrentStock <= 0) first, then by CurrentStock ascending, then Category, then Product
  low.sort(function (a, b) {
    var aOut = Number(a.CurrentStock) <= 0 ? 0 : 1;
    var bOut = Number(b.CurrentStock) <= 0 ? 0 : 1;
    if (aOut !== bOut) return aOut - bOut;
    if (Number(a.CurrentStock) !== Number(b.CurrentStock)) return Number(a.CurrentStock) - Number(b.CurrentStock);
    var catCmp = String(a.CategoryName || '').localeCompare(String(b.CategoryName || ''));
    if (catCmp !== 0) return catCmp;
    return String(a.ProductName || '').localeCompare(String(b.ProductName || ''));
  });
  return ok({ products: low });
  })();
}

function getExpiringBatches(userId, withinDays, storeId) {
  return safe(function () {
  authorize(userId, PERMISSIONS.VIEW_PRODUCTS);
  var days = Number(withinDays) || 90;
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() + days);
  var scoped = (storeId !== undefined && storeId !== null && String(storeId) !== '') ? resolveStoreId(storeId) : '';
  var products = readTable(SHEETS.PRODUCTS).rows;
  var nameById = {}; products.forEach(function (p) { nameById[p.ProductID] = p.ProductName; });

  var batches = readTable(SHEETS.BATCHES).rows.filter(function (b) {
    if (Number(b.Quantity) <= 0 || !b.ExpiryDate) return false;
    if (new Date(b.ExpiryDate) > cutoff) return false;
    if (scoped && resolveStoreId(b.StoreID) !== scoped) return false;
    return true;
  });
  batches.sort(function (a, b) { return new Date(a.ExpiryDate) - new Date(b.ExpiryDate); });
  batches.forEach(function (b) {
    b.ProductName = nameById[b.ProductID] || b.ProductID;
    b.StoreName = storeLabel(b.StoreID);
  });
  return ok({ batches: batches });
  })();
}

// ── Batches & inventory rollup (internal helpers) ─────────────────────────

// Adds stock as a new batch and recalculates the Inventory rollup + logs
// the movement. Used by receiveBatch(), opening stock, returns and transfers.
//
// The ledger type is derived from the reference type so every caller gets a
// truthful movement history without having to repeat the type:
//   Purchase      → Purchase
//   Return        → Return
//   StoreTransfer → TransferIn
//   OpeningStock  → OpeningStock
function receiveBatch(productId, qty, purchasePrice, sellingPrice, expiryDate, supplierId, refType, refId, userId, notes, storeId) {
  var sid = resolveStoreId(storeId);
  var movementType = STOCK_MOVEMENT_TYPES.PURCHASE;
  if (refType === 'Return') movementType = STOCK_MOVEMENT_TYPES.RETURN;
  else if (refType === 'StoreTransfer') movementType = STOCK_MOVEMENT_TYPES.TRANSFER_IN;
  else if (refType === 'OpeningStock') movementType = STOCK_MOVEMENT_TYPES.OPENING;

  var batchId = nextId('BAT', SHEETS.BATCHES, 'BatchID');
  appendRow(SHEETS.BATCHES, {
    BatchID: batchId, ProductID: productId, BatchNumber: batchId,
    ManufacturingDate: '', ExpiryDate: expiryDate || '', Quantity: qty,
    PurchasePrice: purchasePrice || 0, SellingPrice: sellingPrice || 0, SupplierID: supplierId || '',
    StoreID: sid
  });
  recalculateInventory(productId, sid, batchId, movementType, qty, refType, refId, userId, notes);
  return batchId;
}

// Records the OPENING BALANCE of a product in a store — the very first
// quantity that arrives for that product at that location.
function addOpeningBatch(productId, qty, purchasePrice, sellingPrice, expiryDate, userId, storeId) {
  var sid = resolveStoreId(storeId);
  return receiveBatch(productId, qty, purchasePrice, sellingPrice, expiryDate, '', 'OpeningStock', productId, userId, 'Opening balance', sid);
}

// Recomputes Inventory.CurrentStock/AvailableStock from the Batches table
// (source of truth = sum of batch quantities for that product AT THAT STORE)
// and writes one StockMovements row describing the change.
function recalculateInventory(productId, storeId, batchId, type, qtyChange, refType, refId, userId, notes) {
  var sid = resolveStoreId(storeId);
  var batches = readTable(SHEETS.BATCHES).rows.filter(function (b) {
    return b.ProductID === productId && resolveStoreId(b.StoreID) === sid;
  });
  var total = batches.reduce(function (sum, b) { return sum + Number(b.Quantity || 0); }, 0);

  var inv = findInventoryRow(productId, sid);
  var previousStock = inv ? Number(inv.CurrentStock || 0) : 0;
  if (inv) {
    updateRowByIndex(SHEETS.INVENTORY, inv._row, {
      CurrentStock: total, AvailableStock: total, LastUpdated: nowIso(), StoreID: sid
    });
  } else {
    appendRow(SHEETS.INVENTORY, { ProductID: productId, CurrentStock: total, LoosePills: 0, LoosePillsBatchID: '', ReservedStock: 0, AvailableStock: total, LastUpdated: nowIso(), StoreID: sid });
  }

  appendRow(SHEETS.STOCK_MOVEMENTS, {
    MovementID: Utilities.getUuid(), Date: nowIso(), ProductID: productId, BatchID: batchId || '',
    Type: type, Quantity: qtyChange, PreviousStock: previousStock, NewStock: total,
    ReferenceType: refType || '', ReferenceID: refId || '', Remarks: notes || '', UserID: userId,
    StoreID: sid
  });
}

// Deducts `qty` units of a product using FEFO (first-expire-first-out)
// across as many batches as needed. Returns the list of {batchId, qty}
// consumed, or throws if there isn't enough stock.
function deductStockFEFO(productId, storeId, qty, type, refType, refId, userId, notes) {
  var sid = resolveStoreId(storeId);
  var batches = readTable(SHEETS.BATCHES).rows.filter(function (b) {
    return b.ProductID === productId && resolveStoreId(b.StoreID) === sid && Number(b.Quantity) > 0;
  });
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

  recalculateInventory(productId, sid, consumed.length ? consumed[0].batchId : '', type, -qty, refType, refId, userId, notes);
  return consumed;
}

// Deducts individual pills using FEFO. First uses loose pills from an
// already-broken strip, then breaks new strips from the soonest-expiring
// batch. Updates LoosePills/LoosePillsBatchID on the Inventory row.
function deductPillsFEFO(productId, storeId, pillsWanted, type, refType, refId, userId, notes) {
  var sid = resolveStoreId(storeId);
  var product = findRowById(SHEETS.PRODUCTS, 'ProductID', productId);
  var pillsPerUnit = Number(product ? product.PillsPerUnit : 0);
  if (!pillsPerUnit || pillsPerUnit <= 0) throw new Error('Product is not configured for pill selling (PillsPerUnit is 0).');

  var inv = findInventoryRow(productId, sid);
  var loosePills = inv ? Number(inv.LoosePills) || 0 : 0;
  var currentUnits = inv ? Number(inv.CurrentStock) || 0 : 0;

  // Case 1: loose pills are enough
  if (loosePills >= pillsWanted) {
    if (inv) updateRowByIndex(SHEETS.INVENTORY, inv._row, { LoosePills: loosePills - pillsWanted, LastUpdated: nowIso() });
    appendRow(SHEETS.STOCK_MOVEMENTS, {
      MovementID: Utilities.getUuid(), Date: nowIso(), ProductID: productId, BatchID: inv ? inv.LoosePillsBatchID || '' : '',
      Type: type, Quantity: -pillsWanted, PreviousStock: loosePills + currentUnits * pillsPerUnit,
      NewStock: (loosePills - pillsWanted) + currentUnits * pillsPerUnit,
      ReferenceType: refType || '', ReferenceID: refId || '', Remarks: notes || ('Used ' + pillsWanted + ' loose pills'),
      UserID: userId, StoreID: sid
    });
    return [{ batchId: inv ? inv.LoosePillsBatchID || '' : '', qty: pillsWanted, unitCost: (Number(product ? product.PurchasePrice : 0) / (pillsPerUnit || 1)) }];
  }

  // Case 2: need to break new strips
  var pillsStillNeeded = pillsWanted - loosePills;
  var unitsToBreak = Math.ceil(pillsStillNeeded / pillsPerUnit);
  if (unitsToBreak > currentUnits) throw new Error('Not enough stock (need ' + pillsWanted + ' pills, have ' + (currentUnits * pillsPerUnit + loosePills) + ').');

  var consumed = deductStockFEFO(productId, sid, unitsToBreak, type, refType, refId, userId, notes || ('Broke ' + unitsToBreak + ' unit(s) for ' + pillsWanted + ' pills'));

  var pillsFromNewBreaks = unitsToBreak * pillsPerUnit;
  var newLoosePills = loosePills + pillsFromNewBreaks - pillsWanted;
  var lastBatchId = consumed.length ? consumed[consumed.length - 1].batchId : (inv ? inv.LoosePillsBatchID || '' : '');
  if (inv) updateRowByIndex(SHEETS.INVENTORY, inv._row, { LoosePills: newLoosePills, LoosePillsBatchID: lastBatchId, LastUpdated: nowIso() });

  return consumed;
}

// ============================================================================
//  Manual stock adjustments (Asella Organic style)
//  A single, auditable entry point for every "the numbers changed and
//  nobody sold anything" scenario: opening balances, recounts, damage,
//  expiry write-offs and customer returns coming back in.
// ============================================================================

// input: { productId, storeId, movementType, direction, quantity, reason,
//          notes, purchasePrice, sellingPrice, expiryDate }
function recordStockAdjustment(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.ADJUST_STOCK);
  if (!input.productId) return fail('Select a product.');

  var product = findRowById(SHEETS.PRODUCTS, 'ProductID', input.productId);
  if (!product) return fail('Product not found.');

  var typeKey = String(input.movementType || 'Adjustment');
  var config = MANUAL_ADJUSTMENT_TYPES[typeKey];
  if (!config) return fail('Unknown adjustment type "' + typeKey + '".');

  var quantity = Number(input.quantity);
  if (!(quantity > 0)) return fail('Enter a quantity greater than zero.');

  var reason = String(input.reason || '').trim();
  if (reason.length < 3) return fail('A reason is required (at least 3 characters) — it appears in the stock audit trail.');

  var storeId = resolveStoreId(input.storeId);
  if (!storeExists(storeId)) return fail('Store not found.');

  // Direction is constrained by the type: "in"-only types can't be used to
  // remove stock and vice versa.
  var direction = config.direction;
  if (config.direction === 'both') direction = (input.direction === 'out') ? 'out' : 'in';

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var movementId = Utilities.getUuid();
    var remarks = reason + (input.notes ? ' — ' + input.notes : '');

    if (direction === 'in') {
      // Stock coming IN always creates a batch, so cost, expiry and FEFO keep
      // working exactly like a purchased delivery.
      var cost = input.purchasePrice !== undefined && input.purchasePrice !== '' ? Number(input.purchasePrice) : Number(product.PurchasePrice || 0);
      var price = input.sellingPrice !== undefined && input.sellingPrice !== '' ? Number(input.sellingPrice) : Number(product.SellingPrice || 0);
      var batchId = nextId('BAT', SHEETS.BATCHES, 'BatchID');
      appendRow(SHEETS.BATCHES, {
        BatchID: batchId, ProductID: product.ProductID, BatchNumber: input.batchNumber || batchId,
        ManufacturingDate: input.manufacturingDate || '', ExpiryDate: input.expiryDate || '',
        Quantity: quantity, PurchasePrice: cost, SellingPrice: price, SupplierID: input.supplierId || '',
        StoreID: storeId
      });
      recalculateInventory(product.ProductID, storeId, batchId, typeKey, quantity, 'ManualAdjustment', movementId, userId, remarks);

      // Opening balances also refresh the catalog cost so valuation is right.
      if (typeKey === STOCK_MOVEMENT_TYPES.OPENING && cost > 0) {
        updateRowById(SHEETS.PRODUCTS, 'ProductID', product.ProductID, { PurchasePrice: cost, UpdatedDate: nowIso() });
      }
    } else {
      // Stock going OUT is taken from existing batches (FEFO within the store).
      var available = 0;
      readTable(SHEETS.BATCHES).rows.forEach(function (b) {
        if (b.ProductID === product.ProductID && resolveStoreId(b.StoreID) === storeId) {
          available += Number(b.Quantity || 0);
        }
      });

      if (available < quantity && !config.allowNegative) {
        return fail('Not enough stock to remove — only ' + available + ' unit(s) available at ' + storeLabel(storeId) + '.');
      }

      var taken = Math.min(available, quantity);
      if (taken > 0) {
        var batches = readTable(SHEETS.BATCHES).rows.filter(function (b) {
          return b.ProductID === product.ProductID && resolveStoreId(b.StoreID) === storeId && Number(b.Quantity) > 0;
        });
        batches.sort(function (a, b) {
          var ae = a.ExpiryDate ? new Date(a.ExpiryDate) : new Date('2999-12-31');
          var be = b.ExpiryDate ? new Date(b.ExpiryDate) : new Date('2999-12-31');
          return ae - be;
        });
        var remaining = taken;
        var firstBatchId = '';
        for (var i = 0; i < batches.length && remaining > 0; i++) {
          var batch = batches[i];
          var take = Math.min(Number(batch.Quantity), remaining);
          if (take <= 0) continue;
          if (!firstBatchId) firstBatchId = batch.BatchID;
          updateRowById(SHEETS.BATCHES, 'BatchID', batch.BatchID, { Quantity: Number(batch.Quantity) - take });
          remaining -= take;
        }
        if (quantity > taken) {
          remarks += ' (Requested ' + quantity + ', only ' + taken + ' were on hand — the remainder could not be located.)';
        }
        recalculateInventory(product.ProductID, storeId, firstBatchId, typeKey, -taken, 'ManualAdjustment', movementId, userId, remarks);
      } else {
        // Nothing on hand — still record the loss so the ledger explains it.
        remarks += ' (Stock was already zero for this product at ' + storeLabel(storeId) + '.)';
        recalculateInventory(product.ProductID, storeId, '', typeKey, 0, 'ManualAdjustment', movementId, userId, remarks);
      }
    }

    logAudit(userId, 'Stock', typeKey, product.ProductID, null,
      { qty: quantity, direction: direction, reason: reason, store: storeLabel(storeId) });

    var newStock = 0;
    var invRow = findInventoryRow(product.ProductID, storeId);
    if (invRow) newStock = Number(invRow.CurrentStock || 0);

    return ok({
      movementId: movementId,
      productId: product.ProductID,
      productName: product.ProductName,
      storeId: storeId,
      newQuantity: newStock
    });
  } finally {
    lock.releaseLock();
  }
  })();
}

// ============================================================================
//  Stock movement ledger
//  The append-only history of every quantity change, filterable and
//  paginated exactly like the sales history screen.
// ============================================================================

// filters: { search, productId, type, storeId, from, to, page, pageSize }
function getStockMovements(userId, filters) {
  return safe(function () {
  requireUser(userId);
  filters = filters || {};

  var rows = readTable(SHEETS.STOCK_MOVEMENTS).rows;

  if (filters.productId) {
    rows = rows.filter(function (m) { return m.ProductID === filters.productId; });
  }
  if (filters.type) {
    rows = rows.filter(function (m) { return m.Type === filters.type; });
  }
  if (filters.storeId) {
    var sid = resolveStoreId(filters.storeId);
    rows = rows.filter(function (m) { return resolveStoreId(m.StoreID) === sid; });
  }
  if (filters.from) {
    var from = parseDateStart(filters.from);
    rows = rows.filter(function (m) { return new Date(m.Date) >= from; });
  }
  if (filters.to) {
    var to = parseDateEnd(filters.to);
    rows = rows.filter(function (m) { return new Date(m.Date) <= to; });
  }

  var products = readTable(SHEETS.PRODUCTS).rows;
  var nameById = {};
  products.forEach(function (p) { nameById[p.ProductID] = p.ProductName; });
  var users = readTable(SHEETS.USERS).rows;
  var userById = {};
  users.forEach(function (u) { userById[u.UserID] = u.FullName || u.Username; });
  var storeNames = getStoreNameMap();

  if (filters.search) {
    var q = String(filters.search).toLowerCase();
    rows = rows.filter(function (m) {
      var productName = nameById[m.ProductID] || '';
      return productName.toLowerCase().indexOf(q) > -1 ||
             String(m.Type || '').toLowerCase().indexOf(q) > -1 ||
             String(m.Remarks || '').toLowerCase().indexOf(q) > -1 ||
             String(m.ReferenceID || '').toLowerCase().indexOf(q) > -1 ||
             String(m.BatchID || '').toLowerCase().indexOf(q) > -1 ||
             String(userById[m.UserID] || '').toLowerCase().indexOf(q) > -1;
    });
  }

  rows.sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); });

  var total = rows.length;
  var page = Math.max(1, Number(filters.page) || 1);
  var pageSize = Math.max(1, Math.min(200, Number(filters.pageSize) || 25));
  var pages = Math.max(1, Math.ceil(total / pageSize));
  if (page > pages) page = pages;
  var slice = rows.slice((page - 1) * pageSize, page * pageSize);

  slice.forEach(function (m) {
    m.ProductName = nameById[m.ProductID] || m.ProductID;
    m.UserName = userById[m.UserID] || m.UserID || 'System';
    m.StoreName = storeNames[resolveStoreId(m.StoreID)] || storeLabel(m.StoreID);
    m.Quantity = Number(m.Quantity || 0);
    m.Direction = m.Quantity > 0 ? 'in' : (m.Quantity < 0 ? 'out' : 'flat');
  });

  return ok({ movements: slice, total: total, page: page, pageSize: pageSize, pages: pages });
  })();
}

// The movement history for one product (shown inside the product card).
function getProductStockHistory(userId, productId, storeId, limit) {
  return safe(function () {
  requireUser(userId);
  if (!productId) return fail('Missing product ID.');
  var res = getStockMovements(userId, { productId: productId, storeId: storeId, pageSize: Math.min(100, Number(limit) || 20) });
  if (!res.success) return res;
  return ok({ movements: res.movements, total: res.total });
  })();
}

// ============================================================================
//  Inventory summary (KPI cards)
//  Total value, health tiers and 30-day movement activity — the Asella
//  Organic inventory dashboard, adapted to the pharmacy's batch model.
// ============================================================================

function getInventorySummary(userId, storeId) {
  return safe(function () {
  requireUser(userId);
  var scoped = (storeId !== undefined && storeId !== null && String(storeId) !== '') ? resolveStoreId(storeId) : '';

  var inventory = readTable(SHEETS.INVENTORY).rows;
  var products = readTable(SHEETS.PRODUCTS).rows;
  var productById = {};
  products.forEach(function (p) { productById[p.ProductID] = p; });

  var defaultLow = Number(getSettingsMap().LowStockAlertThreshold || 0);

  var totalUnits = 0, totalValue = 0, totalRetail = 0;
  var outOfStock = 0, critical = 0, low = 0, okCount = 0, productCount = 0;

  inventory.forEach(function (inv) {
    if (scoped && resolveStoreId(inv.StoreID) !== scoped) return;
    var product = productById[inv.ProductID];
    if (!product) return;
    productCount += 1;
    var qty = Number(inv.CurrentStock || 0);
    var threshold = (product.ReorderLevel !== undefined && product.ReorderLevel !== '' && Number(product.ReorderLevel) > 0)
      ? Number(product.ReorderLevel) : defaultLow;
    var health = classifyStock(qty, threshold);
    if (health === STOCK_HEALTH.OUT_OF_STOCK) outOfStock += 1;
    else if (health === STOCK_HEALTH.CRITICAL) critical += 1;
    else if (health === STOCK_HEALTH.LOW) low += 1;
    else okCount += 1;
    totalUnits += qty;
    totalValue += qty * Number(product.PurchasePrice || 0);
    totalRetail += qty * Number(product.SellingPrice || 0);
  });

  // 30-day movement activity.
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  var movements30d = 0, unitsIn30d = 0, unitsOut30d = 0, unitsSold30d = 0, unitsReceived30d = 0;
  readTable(SHEETS.STOCK_MOVEMENTS).rows.forEach(function (m) {
    if (scoped && resolveStoreId(m.StoreID) !== scoped) return;
    if (new Date(m.Date) < cutoff) return;
    movements30d += 1;
    var qty = Number(m.Quantity || 0);
    if (qty > 0) unitsIn30d += qty; else unitsOut30d += Math.abs(qty);
    if (m.Type === STOCK_MOVEMENT_TYPES.SALE) unitsSold30d += Math.abs(qty);
    if (m.Type === STOCK_MOVEMENT_TYPES.PURCHASE || m.Type === STOCK_MOVEMENT_TYPES.OPENING) unitsReceived30d += qty;
  });

  return ok({
    storeId: scoped,
    totalProducts: productCount,
    totalUnits: totalUnits,
    totalStockValue: round2(totalValue),
    totalRetailValue: round2(totalRetail),
    outOfStockCount: outOfStock,
    criticalCount: critical,
    lowCount: low,
    okCount: okCount,
    movements30d: movements30d,
    unitsIn30d: unitsIn30d,
    unitsOut30d: unitsOut30d,
    unitsSold30d: unitsSold30d,
    unitsReceived30d: unitsReceived30d
  });
  })();
}
