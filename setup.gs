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
    MinimumStock: reorderLevel, MaximumStock: qty * 3, ReorderLevel: reorderLevel, SupplierID: '',
    Active: true, CreatedDate: nowIso(), UpdatedDate: nowIso(), CreatedBy: 'admin'
  });
  appendRow(SHEETS.INVENTORY, { ProductID: id, CurrentStock: 0, ReservedStock: 0, AvailableStock: 0, LastUpdated: nowIso() });
  if (qty > 0) addOpeningBatch(id, qty, cost, price, expiry, 'admin');
}
