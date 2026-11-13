// ============================================================================
//  setup.gs — run ONCE after pasting SPREADSHEET_ID into constants.gs
//  Safe to re-run: it only creates what's missing, never overwrites data
//  that's already there (Categories/Roles/Permissions/etc. you seeded via
//  Pharmacy_Database_v1.xlsx are left exactly as they are).
// ============================================================================

function initializeSystem() {
  // Make sure every sheet exists with the right headers (no-op if already there).
  Object.keys(SHEETS).forEach(function (key) { ensureSheet(SHEETS[key]); });

  // Sanity check: Roles/Permissions/RolePermissions must be seeded for auth
  // to work at all — these come from Pharmacy_Database_v1.xlsx, not from code.
  if (readTable(SHEETS.ROLES).rows.length === 0) {
    Logger.log('WARNING: Roles sheet is empty. Import Pharmacy_Database_v1.xlsx ' +
      'or add ROLE_OWNER / ROLE_PHARMACIST / ROLE_CASHIER rows manually before logging in.');
  }
  if (readTable(SHEETS.ROLE_PERMISSIONS).rows.length === 0) {
    Logger.log('WARNING: RolePermissions is empty — every permission check will fail. ' +
      'Import Pharmacy_Database_v1.xlsx or seed this table.');
  }

  // Seed the first Owner login if Users is empty.
  if (readTable(SHEETS.USERS).rows.length === 0) {
    appendRow(SHEETS.USERS, {
      UserID: 'USR000001', FullName: 'Owner', Username: 'admin',
      PasswordHash: hashPassword('ChangeMe123'), RoleID: ROLE_IDS.OWNER,
      Phone: '', Email: '', Active: true, LastLogin: '', CreatedDate: nowIso()
    });
    Logger.log('Created default login -> Username: admin | Password: ChangeMe123');
  } else {
    Logger.log('Users sheet already has accounts — skipped seeding.');
  }

  // Multi-store support: a default store plus the permissions that unlock
  // the store screens. Idempotent — safe to run on an existing database.
  ensureDefaultStore();
  seedNewPermissions();

  // Backfill StoreID on rows created before multi-store support existed.
  migrateStoreColumns();

  // A couple of sample products (with an opening-stock batch each) so the
  // POS screen isn't empty on first run. Safe to deactivate later.
  if (readTable(SHEETS.PRODUCTS).rows.length === 0) {
    var categories = readTable(SHEETS.CATEGORIES).rows;
    var medsCategory = categories.length ? categories[0].CategoryID : '';
    seedProduct('Paracetamol 500mg', medsCategory, 1.5, 3.0, 200, 20, '2027-06-30');
    seedProduct('Amoxicillin 250mg', medsCategory, 3.0, 6.5, 120, 15, '2027-01-15');
    seedProduct('Vitamin C 1000mg', medsCategory, 2.0, 4.0, 80, 10, '2028-03-01');
    Logger.log('Seeded 3 sample products with opening stock.');
  }

  Logger.log('Setup complete. Deploy the web app to start using the system.');
  return 'Setup complete — check the execution log (View > Logs) for your login.';
}

function seedProduct(name, categoryId, cost, price, qty, reorderLevel, expiry) {
  var id = nextId('MED', SHEETS.PRODUCTS, 'ProductID');
  appendRow(SHEETS.PRODUCTS, {
    ProductID: id, Barcode: '', ProductName: name, GenericName: '', Brand: '', CategoryID: categoryId,
    Unit: 'unit', Strength: '', DosageForm: '', PurchasePrice: cost, SellingPrice: price, TaxRate: 0,
    DefaultMargin: 0, PillsPerUnit: 0, SellByPill: false,
    MinimumStock: reorderLevel, MaximumStock: qty * 3, ReorderLevel: reorderLevel, SupplierID: '',
    Active: true, CreatedDate: nowIso(), UpdatedDate: nowIso(), CreatedBy: 'admin',
    StoreID: DEFAULT_STORE_ID
  });
  appendRow(SHEETS.INVENTORY, { ProductID: id, CurrentStock: 0, LoosePills: 0, LoosePillsBatchID: '', ReservedStock: 0, AvailableStock: 0, LastUpdated: nowIso(), StoreID: DEFAULT_STORE_ID });
  if (qty > 0) addOpeningBatch(id, qty, cost, price, expiry, 'admin', DEFAULT_STORE_ID);
}

// ============================================================================
//  Multi-store bootstrap
// ============================================================================

// Creates the default "Main Store" row if it isn't there yet.
function ensureDefaultStore() {
  var existing = findRowById(SHEETS.STORES, 'StoreID', DEFAULT_STORE_ID);
  if (existing) {
    // Make sure exactly one store is flagged as the default.
    if (!(existing.IsDefault === true || existing.IsDefault === 'TRUE')) {
      updateRowById(SHEETS.STORES, 'StoreID', DEFAULT_STORE_ID, { IsDefault: true });
    }
    return DEFAULT_STORE_ID;
  }
  appendRow(SHEETS.STORES, {
    StoreID: DEFAULT_STORE_ID, StoreName: 'Main Store', Code: 'MAIN',
    StoreType: 'Retail', Address: '', Phone: '', Email: '', Manager: '', Phone2: '',
    OpeningDate: todayIsoDate(), IsDefault: true, Active: true, CreatedDate: nowIso(),
    Notes: 'Default store — created automatically.'
  });
  Logger.log('Created default store: ' + DEFAULT_STORE_ID + ' (Main Store).');
  return DEFAULT_STORE_ID;
}

// Adds the permissions introduced with the store / stock-adjustment work.
// They are not in the original Pharmacy_Database_v1.xlsx, so without this
// the new screens would be invisible to every role except the Owner
// (the Owner bypasses the RolePermissions sheet by design).
function seedNewPermissions() {
  var definitions = [
    { id: PERMISSIONS.MANAGE_STORES, name: 'Manage Stores', desc: 'Create, edit and deactivate stores' },
    { id: PERMISSIONS.VIEW_STOCK_MOVEMENTS, name: 'View Stock Movements', desc: 'View the stock movement ledger' },
    { id: PERMISSIONS.TRANSFER_STOCK, name: 'Transfer Stock', desc: 'Transfer stock between stores' }
  ];

  definitions.forEach(function (def) {
    if (!findRowById(SHEETS.PERMISSIONS, 'PermissionID', def.id)) {
      appendRow(SHEETS.PERMISSIONS, { PermissionID: def.id, PermissionName: def.name, Description: def.desc });
    }
  });

  // Role → permissions granted by default.
  var grants = {};
  grants[ROLE_IDS.OWNER] = [PERMISSIONS.MANAGE_STORES, PERMISSIONS.VIEW_STOCK_MOVEMENTS, PERMISSIONS.TRANSFER_STOCK];
  grants[ROLE_IDS.PHARMACIST] = [PERMISSIONS.VIEW_STOCK_MOVEMENTS, PERMISSIONS.TRANSFER_STOCK];
  grants[ROLE_IDS.CASHIER] = [PERMISSIONS.VIEW_STOCK_MOVEMENTS];

  Object.keys(grants).forEach(function (roleId) {
    if (!findRowById(SHEETS.ROLES, 'RoleID', roleId)) return; // role not seeded — skip
    grants[roleId].forEach(function (permissionId) {
      var exists = findRows(SHEETS.ROLE_PERMISSIONS, function (rp) {
        return rp.RoleID === roleId && rp.PermissionID === permissionId;
      })[0];
      if (!exists) appendRow(SHEETS.ROLE_PERMISSIONS, { RoleID: roleId, PermissionID: permissionId });
    });
  });

  clearPermissionCache();
}

// Backfills StoreID on every table that became store-aware. Rows created
// before multi-store support existed belong to the default store.
//
// Safe to run repeatedly: it only touches rows whose StoreID is empty.
function migrateStoreColumns() {
  var tables = [
    SHEETS.PRODUCTS, SHEETS.BATCHES, SHEETS.INVENTORY,
    SHEETS.STOCK_MOVEMENTS, SHEETS.SALES, SHEETS.PURCHASES
  ];

  var moved = 0;
  tables.forEach(function (name) {
    if (!HEADERS[name] || HEADERS[name].indexOf('StoreID') === -1) return;
    var rows = readTable(name).rows;
    rows.forEach(function (row) {
      if (row.StoreID === '' || row.StoreID === null || row.StoreID === undefined) {
        updateRowByIndex(name, row._row, { StoreID: DEFAULT_STORE_ID });
        moved += 1;
      }
    });
  });

  if (moved) Logger.log('Store migration: backfilled StoreID on ' + moved + ' row(s).');
  return moved;
}

// Full one-shot upgrade for an existing database: makes sure the default
// store, the new permissions and the StoreID backfill are all in place.
// Run this once from the Apps Script editor after deploying the new code.
function upgradeToMultiStore() {
  ensureDefaultStore();
  seedNewPermissions();
  migrateStoreColumns();
  clearSchemaCache();
  Logger.log('Multi-store upgrade complete.');
  return 'Multi-store upgrade complete — default store, permissions and StoreID backfill are in place.';
}
