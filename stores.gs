// ============================================================================
//  stores.gs — Stores (branches / outlets / warehouses)
//  A store is a physical location that holds its own stock. Every stock
//  movement, batch, sale and purchase is scoped to a store, so the same
//  product can sit in three different branches at once.
//
//  Design notes
//  ------------
//  * Inventory is keyed by (ProductID, StoreID) — not ProductID alone.
//  * A store-aware lookup that is given no store id falls back to
//    DEFAULT_STORE_ID, so a single-store deployment keeps behaving exactly
//    like the pre-multi-store system.
//  * Stock is NEVER edited directly. Inter-store transfers post a matched
//    pair of ledger entries (TransferOut / TransferIn) so both sides of the
//    move are permanently auditable.
// ============================================================================

// ── Helpers ───────────────────────────────────────────────────────────────

// Normalises a store id. Blank / missing => the default store.
function resolveStoreId(storeId) {
  var sid = (storeId === undefined || storeId === null) ? '' : String(storeId).trim();
  return sid || DEFAULT_STORE_ID;
}

// True when the store id refers to a store that actually exists.
function storeExists(storeId) {
  var sid = resolveStoreId(storeId);
  if (sid === DEFAULT_STORE_ID) return true; // always available, even unseeded
  return !!findRowById(SHEETS.STORES, 'StoreID', sid);
}

// { storeId: storeName } for every store.
function getStoreNameMap() {
  var map = {};
  map[DEFAULT_STORE_ID] = 'Main Store';
  readTable(SHEETS.STORES).rows.forEach(function (s) {
    if (s.StoreName) map[s.StoreID] = s.StoreName;
  });
  return map;
}

// The id of the store flagged as default (falls back to DEFAULT_STORE_ID).
function getDefaultStoreId() {
  var stores = readTable(SHEETS.STORES).rows;
  for (var i = 0; i < stores.length; i++) {
    var isDefault = stores[i].IsDefault === true || stores[i].IsDefault === 'TRUE';
    if (isDefault) return stores[i].StoreID;
  }
  return DEFAULT_STORE_ID;
}

// ── Store CRUD ────────────────────────────────────────────────────────────

// Lists every store with live stock statistics for each one.
function getStores(userId) {
  return safe(function () {
    requireUser(userId);

    var stores = readTable(SHEETS.STORES).rows.slice();
    var inventory = readTable(SHEETS.INVENTORY).rows;
    var products = readTable(SHEETS.PRODUCTS).rows;
    var productById = {};
    products.forEach(function (p) { productById[p.ProductID] = p; });

    // Aggregate stock + value per store.
    var stats = {};
    inventory.forEach(function (inv) {
      var sid = resolveStoreId(inv.StoreID);
      if (!stats[sid]) stats[sid] = { units: 0, value: 0, products: 0, outOfStock: 0, lowStock: 0 };
      var qty = Number(inv.CurrentStock || 0);
      var product = productById[inv.ProductID] || {};
      var cost = Number(product.PurchasePrice || 0);
      stats[sid].units += qty;
      stats[sid].value += qty * cost;
      stats[sid].products += 1;
      if (qty <= 0) stats[sid].outOfStock += 1;
    });

    var defaultLow = Number(getSettingsMap().LowStockAlertThreshold || 0);
    Object.keys(stats).forEach(function (sid) {
      // Count low stock per store using the product's own reorder level.
      var low = 0;
      inventory.forEach(function (inv) {
        if (resolveStoreId(inv.StoreID) !== sid) return;
        var qty = Number(inv.CurrentStock || 0);
        if (qty <= 0) return;
        var product = productById[inv.ProductID] || {};
        var threshold = (product.ReorderLevel !== undefined && product.ReorderLevel !== '' && Number(product.ReorderLevel) > 0)
          ? Number(product.ReorderLevel) : defaultLow;
        if (qty <= threshold) low += 1;
      });
      stats[sid].lowStock = low;
    });

    // Make sure the default store always appears, even before it is seeded.
    var hasDefault = false;
    stores.forEach(function (s) { if (s.StoreID === DEFAULT_STORE_ID) hasDefault = true; });
    if (!hasDefault) {
      stores.unshift({
        StoreID: DEFAULT_STORE_ID, StoreName: 'Main Store', Code: 'MAIN',
        StoreType: 'Retail', Address: '', Phone: '', Email: '', Manager: '',
        Phone2: '', OpeningDate: '', IsDefault: true, Active: true,
        CreatedDate: '', Notes: 'Default store — created automatically.'
      });
    }

    stores.forEach(function (s) {
      var st = stats[s.StoreID] || { units: 0, value: 0, products: 0, outOfStock: 0, lowStock: 0 };
      s.UnitCount = st.units;
      s.StockValue = round2(st.value);
      s.ProductCount = st.products;
      s.OutOfStockCount = st.outOfStock;
      s.LowStockCount = st.lowStock;
      s.IsDefault = (s.IsDefault === true || s.IsDefault === 'TRUE');
    });

    stores.sort(function (a, b) {
      if (a.IsDefault !== b.IsDefault) return a.IsDefault ? -1 : 1;
      return String(a.StoreName).localeCompare(String(b.StoreName));
    });

    return ok({ stores: stores, defaultStoreId: getDefaultStoreId() });
  })();
}

function createStore(userId, input) {
  return safe(function () {
    authorize(userId, PERMISSIONS.MANAGE_STORES);
    if (!input.storeName || !String(input.storeName).trim()) return fail('Store name is required.');

    var name = String(input.storeName).trim();
    var duplicate = findRows(SHEETS.STORES, function (s) {
      return String(s.StoreName || '').toLowerCase() === name.toLowerCase();
    })[0];
    if (duplicate) return fail('A store named "' + name + '" already exists.');

    var id = nextId('STORE', SHEETS.STORES, 'StoreID');
    appendRow(SHEETS.STORES, {
      StoreID: id,
      StoreName: name,
      Code: (input.code || '').trim() || id,
      StoreType: input.storeType || STORE_TYPES[0],
      Address: input.address || '',
      Phone: input.phone || '',
      Email: input.email || '',
      Manager: input.manager || '',
      Phone2: input.phone2 || '',
      OpeningDate: input.openingDate || '',
      IsDefault: false,
      Active: true,
      CreatedDate: nowIso(),
      Notes: input.notes || ''
    });

    logAudit(userId, 'Stores', 'CREATE', id, null, name);
    return ok({ storeId: id });
  })();
}

function updateStore(userId, input) {
  return safe(function () {
    authorize(userId, PERMISSIONS.MANAGE_STORES);
    if (!input.storeId) return fail('Missing store ID.');
    var store = findRowById(SHEETS.STORES, 'StoreID', input.storeId);
    if (!store) return fail('Store not found.');

    var name = String(input.storeName || '').trim();
    if (!name) return fail('Store name is required.');

    var updates = {
      StoreName: name,
      Code: (input.code || '').trim() || store.Code,
      StoreType: input.storeType || store.StoreType,
      Address: input.address || '',
      Phone: input.phone || '',
      Email: input.email || '',
      Manager: input.manager || '',
      Phone2: input.phone2 || '',
      OpeningDate: input.openingDate || '',
      Notes: input.notes || ''
    };
    updateRowById(SHEETS.STORES, 'StoreID', input.storeId, updates);
    logAudit(userId, 'Stores', 'UPDATE', input.storeId);
    return ok({});
  })();
}

// Deactivates a store. The default store can never be deactivated, and a
// store that still holds stock is refused so nothing is silently orphaned.
function deactivateStore(userId, storeId) {
  return safe(function () {
    authorize(userId, PERMISSIONS.MANAGE_STORES);
    var sid = resolveStoreId(storeId);
    if (sid === getDefaultStoreId()) return fail('The default store cannot be deactivated.');

    var store = findRowById(SHEETS.STORES, 'StoreID', sid);
    if (!store) return fail('Store not found.');
    if (store.Active === false || store.Active === 'FALSE') return fail('This store is already inactive.');

    var remaining = 0;
    readTable(SHEETS.INVENTORY).rows.forEach(function (inv) {
      if (resolveStoreId(inv.StoreID) === sid) remaining += Number(inv.CurrentStock || 0);
    });
    if (remaining > 0) {
      return fail('This store still holds ' + remaining + ' units. Transfer the stock to another store first.');
    }

    updateRowById(SHEETS.STORES, 'StoreID', sid, { Active: false });
    logAudit(userId, 'Stores', 'DEACTIVATE', sid);
    return ok({});
  })();
}

// ── Per-store stock views ─────────────────────────────────────────────────

// Stock position for every product inside one store.
function getStoreInventory(userId, storeId) {
  return safe(function () {
    requireUser(userId);
    var sid = resolveStoreId(storeId);

    var inventory = readTable(SHEETS.INVENTORY).rows.filter(function (inv) {
      return resolveStoreId(inv.StoreID) === sid;
    });
    var products = readTable(SHEETS.PRODUCTS).rows;
    var productById = {};
    products.forEach(function (p) { productById[p.ProductID] = p; });

    var defaultLow = Number(getSettingsMap().LowStockAlertThreshold || 0);
    var out = inventory.map(function (inv) {
      var product = productById[inv.ProductID] || {};
      var qty = Number(inv.CurrentStock || 0);
      var threshold = (product.ReorderLevel !== undefined && product.ReorderLevel !== '' && Number(product.ReorderLevel) > 0)
        ? Number(product.ReorderLevel) : defaultLow;
      var pillsPerUnit = Number(product.PillsPerUnit) || 0;
      var sellByPill = product.SellByPill === true || product.SellByPill === 'TRUE';
      return {
        ProductID: inv.ProductID,
        ProductName: product.ProductName || inv.ProductID,
        GenericName: product.GenericName || '',
        CategoryID: product.CategoryID || '',
        SellingPrice: product.SellingPrice || 0,
        PurchasePrice: product.PurchasePrice || 0,
        CurrentStock: qty,
        LoosePills: Number(inv.LoosePills || 0),
        DisplayStock: (sellByPill && pillsPerUnit > 0) ? qty * pillsPerUnit + Number(inv.LoosePills || 0) : qty,
        Threshold: threshold,
        StockHealth: classifyStock(qty, threshold),
        StockValue: round2(qty * (Number(product.PurchasePrice || 0))),
        LastUpdated: inv.LastUpdated || ''
      };
    });
    out.sort(function (a, b) { return a.CurrentStock - b.CurrentStock || String(a.ProductName).localeCompare(String(b.ProductName)); });
    return ok({ storeId: sid, inventory: out });
  })();
}

// KPI numbers for one store — the Asella-style inventory summary.
function getStoreSummary(userId, storeId) {
  return safe(function () {
    requireUser(userId);
    var sid = resolveStoreId(storeId);

    var inventory = readTable(SHEETS.INVENTORY).rows.filter(function (inv) {
      return resolveStoreId(inv.StoreID) === sid;
    });
    var products = readTable(SHEETS.PRODUCTS).rows;
    var productById = {};
    products.forEach(function (p) { productById[p.ProductID] = p; });

    var defaultLow = Number(getSettingsMap().LowStockAlertThreshold || 0);
    var totalUnits = 0, totalValue = 0, totalRetail = 0;
    var outOfStock = 0, critical = 0, low = 0, okCount = 0;

    inventory.forEach(function (inv) {
      var qty = Number(inv.CurrentStock || 0);
      var product = productById[inv.ProductID] || {};
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

    // Last 30 days of movement activity for this store.
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    var movements = 0, unitsIn = 0, unitsOut = 0;
    readTable(SHEETS.STOCK_MOVEMENTS).rows.forEach(function (m) {
      if (resolveStoreId(m.StoreID) !== sid) return;
      if (new Date(m.Date) < cutoff) return;
      movements += 1;
      var qty = Number(m.Quantity || 0);
      if (qty > 0) unitsIn += qty; else unitsOut += Math.abs(qty);
    });

    return ok({
      storeId: sid,
      totalProducts: inventory.length,
      totalUnits: totalUnits,
      totalStockValue: round2(totalValue),
      totalRetailValue: round2(totalRetail),
      outOfStockCount: outOfStock,
      criticalCount: critical,
      lowCount: low,
      okCount: okCount,
      movements30d: movements,
      unitsIn30d: unitsIn,
      unitsOut30d: unitsOut
    });
  })();
}

// ── Inter-store transfers ─────────────────────────────────────────────────

// Moves stock from one store to another. Posts a matched pair of ledger
// entries (TransferOut on the source, TransferIn on the destination) and
// records the transfer for reporting.
function transferStock(userId, input) {
  return safe(function () {
    authorize(userId, PERMISSIONS.TRANSFER_STOCK);
    if (!input.productId) return fail('Select a product to transfer.');
    var fromId = resolveStoreId(input.fromStoreId);
    var toId = resolveStoreId(input.toStoreId);
    if (fromId === toId) return fail('The source and destination stores must be different.');
    if (!storeExists(fromId)) return fail('Source store not found.');
    if (!storeExists(toId)) return fail('Destination store not found.');

    var qty = Number(input.quantity);
    if (!(qty > 0)) return fail('Enter a quantity greater than zero.');
    if (!input.reason || !String(input.reason).trim()) return fail('A reason is required for every transfer.');

    var product = findRowById(SHEETS.PRODUCTS, 'ProductID', input.productId);
    if (!product) return fail('Product not found.');

    var lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      var available = 0;
      readTable(SHEETS.BATCHES).rows.forEach(function (b) {
        if (b.ProductID === product.ProductID && resolveStoreId(b.StoreID) === fromId) {
          available += Number(b.Quantity || 0);
        }
      });
      if (available < qty) {
        return fail('Not enough stock at the source store (have ' + available + ', need ' + qty + ').');
      }

      // Take the units out of the source store's batches (FEFO within the store).
      var batches = readTable(SHEETS.BATCHES).rows.filter(function (b) {
        return b.ProductID === product.ProductID && resolveStoreId(b.StoreID) === fromId && Number(b.Quantity) > 0;
      });
      batches.sort(function (a, b) {
        var ae = a.ExpiryDate ? new Date(a.ExpiryDate) : new Date('2999-12-31');
        var be = b.ExpiryDate ? new Date(b.ExpiryDate) : new Date('2999-12-31');
        return ae - be;
      });

      var remaining = qty;
      var moved = [];
      for (var i = 0; i < batches.length && remaining > 0; i++) {
        var batch = batches[i];
        var take = Math.min(Number(batch.Quantity), remaining);
        if (take <= 0) continue;
        updateRowById(SHEETS.BATCHES, 'BatchID', batch.BatchID, { Quantity: Number(batch.Quantity) - take });
        moved.push({ batchId: batch.BatchID, qty: take, unitCost: Number(batch.PurchasePrice || 0), expiryDate: batch.ExpiryDate || '' });
        remaining -= take;
      }

      var transferId = nextId('TRF', SHEETS.STORE_TRANSFERS, 'TransferID');
      var totalValue = 0;

      moved.forEach(function (m) {
        // Out of the source store…
        recalculateInventory(product.ProductID, fromId, m.batchId, STOCK_MOVEMENT_TYPES.TRANSFER_OUT, -m.qty,
          'StoreTransfer', transferId, userId, 'Transfer to ' + storeLabel(toId) + ': ' + input.reason);

        // …and into the destination store, as a new batch carrying the same
        // expiry date so FEFO keeps working on the receiving side.
        var newBatchId = receiveBatch(
          product.ProductID, m.qty, m.unitCost, Number(product.SellingPrice || 0), m.expiryDate, '',
          'StoreTransfer', transferId, userId, 'Transfer from ' + storeLabel(fromId) + ': ' + input.reason, toId);
        totalValue += m.qty * m.unitCost;
      });

      appendRow(SHEETS.STORE_TRANSFERS, {
        TransferID: transferId, Date: nowIso(), ReferenceNumber: input.referenceNumber || transferId,
        FromStoreID: fromId, ToStoreID: toId, ProductID: product.ProductID, ProductName: product.ProductName,
        Quantity: qty, UnitCost: round2(moved.length ? moved[0].unitCost : 0), TotalValue: round2(totalValue),
        Reason: String(input.reason).trim(), Status: 'Completed',
        Notes: input.notes || '', CreatedBy: userId, CreatedDate: nowIso()
      });

      logAudit(userId, 'Stores', 'TRANSFER', transferId,
        { product: product.ProductName, qty: qty, from: fromId },
        { to: toId, reason: input.reason });
      return ok({ transferId: transferId, quantity: qty, fromStoreId: fromId, toStoreId: toId });
    } finally {
      lock.releaseLock();
    }
  })();
}

// Transfer history, newest first, with optional filters.
function getStoreTransfers(userId, filters) {
  return safe(function () {
    requireUser(userId);
    filters = filters || {};
    var rows = readTable(SHEETS.STORE_TRANSFERS).rows;

    if (filters.storeId) {
      var sid = resolveStoreId(filters.storeId);
      rows = rows.filter(function (r) { return r.FromStoreID === sid || r.ToStoreID === sid; });
    }
    if (filters.from) {
      var from = parseDateStart(filters.from);
      rows = rows.filter(function (r) { return new Date(r.Date) >= from; });
    }
    if (filters.to) {
      var to = parseDateEnd(filters.to);
      rows = rows.filter(function (r) { return new Date(r.Date) <= to; });
    }
    if (filters.search) {
      var q = String(filters.search).toLowerCase();
      rows = rows.filter(function (r) {
        return String(r.ProductName || '').toLowerCase().indexOf(q) > -1 ||
               String(r.ReferenceNumber || '').toLowerCase().indexOf(q) > -1 ||
               String(r.TransferID || '').toLowerCase().indexOf(q) > -1 ||
               String(r.Reason || '').toLowerCase().indexOf(q) > -1;
      });
    }

    rows.sort(function (a, b) { return new Date(b.Date) - new Date(a.Date); });

    var nameMap = getStoreNameMap();
    rows.forEach(function (r) {
      r.FromStoreName = nameMap[r.FromStoreID] || r.FromStoreID;
      r.ToStoreName = nameMap[r.ToStoreID] || r.ToStoreID;
    });

    var total = rows.length;
    var page = Math.max(1, Number(filters.page) || 1);
    var pageSize = Math.max(1, Math.min(200, Number(filters.pageSize) || 25));
    var pages = Math.max(1, Math.ceil(total / pageSize));
    if (page > pages) page = pages;

    return ok({
      transfers: rows.slice((page - 1) * pageSize, page * pageSize),
      total: total, page: page, pageSize: pageSize, pages: pages
    });
  })();
}

// Sales performance per store over a date range.
function getStoreSalesReport(userId, from, to) {
  return safe(function () {
    requireUser(userId);
    var start = from ? parseDateStart(from) : new Date(0);
    var end = to ? parseDateEnd(to) : new Date();

    var nameMap = getStoreNameMap();
    var buckets = {};
    Object.keys(nameMap).forEach(function (sid) {
      buckets[sid] = { storeId: sid, storeName: nameMap[sid], transactions: 0, revenue: 0, voided: 0 };
    });

    readTable(SHEETS.SALES).rows.forEach(function (s) {
      var d = new Date(s.SaleDate);
      if (d < start || d > end) return;
      var sid = resolveStoreId(s.StoreID);
      if (!buckets[sid]) buckets[sid] = { storeId: sid, storeName: nameMap[sid] || sid, transactions: 0, revenue: 0, voided: 0 };
      if (String(s.Status || '').toLowerCase() === 'voided') {
        buckets[sid].voided += 1;
        return;
      }
      buckets[sid].transactions += 1;
      buckets[sid].revenue += Number(s.GrandTotal || 0);
    });

    var rows = Object.keys(buckets).map(function (k) {
      var b = buckets[k];
      b.revenue = round2(b.revenue);
      return b;
    });
    rows.sort(function (a, b) { return b.revenue - a.revenue; });
    return ok({ report: rows });
  })();
}

// Human-readable store name for an id.
function storeLabel(storeId) {
  var sid = resolveStoreId(storeId);
  var store = findRowById(SHEETS.STORES, 'StoreID', sid);
  if (store && store.StoreName) return store.StoreName;
  return sid === DEFAULT_STORE_ID ? 'Main Store' : sid;
}
