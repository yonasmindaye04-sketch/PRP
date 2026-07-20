// ============================================================================
//  masters.gs — Categories, Suppliers, Customers
//  Simple master-data CRUD modules. All keyed by ID, never by name.
// ============================================================================

// ── Categories ────────────────────────────────────────────────────────────
function getCategories(userId) {
  return safe(function () {
  requireUser(userId);
  var rows = readTable(SHEETS.CATEGORIES).rows.filter(function (c) { return c.Active !== false && c.Active !== 'FALSE'; });
  return ok({ categories: rows });
  })();
}

function createCategory(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_CATEGORIES);
  if (!input.categoryName) return fail('Category name is required.');
  var id = nextId('CAT', SHEETS.CATEGORIES, 'CategoryID');
  appendRow(SHEETS.CATEGORIES, { CategoryID: id, CategoryName: input.categoryName, Description: input.description || '', Active: true });
  logAudit(userId, 'Categories', 'CREATE', id);
  return ok({ categoryId: id });
  })();
}

function updateCategory(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_CATEGORIES);
  updateRowById(SHEETS.CATEGORIES, 'CategoryID', input.categoryId, { CategoryName: input.categoryName, Description: input.description || '' });
  logAudit(userId, 'Categories', 'UPDATE', input.categoryId);
  return ok({});
  })();
}

function deleteCategory(userId, categoryId) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_CATEGORIES);
  updateRowById(SHEETS.CATEGORIES, 'CategoryID', categoryId, { Active: false });
  logAudit(userId, 'Categories', 'DEACTIVATE', categoryId);
  return ok({});
  })();
}

// ── Suppliers ─────────────────────────────────────────────────────────────
function getSuppliers(userId) {
  return safe(function () {
  requireUser(userId);
  var rows = readTable(SHEETS.SUPPLIERS).rows.filter(function (s) { return s.Active !== false && s.Active !== 'FALSE'; });
  return ok({ suppliers: rows });
  })();
}

function createSupplier(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_SUPPLIERS);
  if (!input.supplierName) return fail('Supplier name is required.');
  var id = nextId('SUP', SHEETS.SUPPLIERS, 'SupplierID');
  var opening = Number(input.openingBalance) || 0;
  appendRow(SHEETS.SUPPLIERS, {
    SupplierID: id, SupplierName: input.supplierName, ContactPerson: input.contactPerson || '',
    Phone: input.phone || '', Email: input.email || '', Address: input.address || '',
    TaxNumber: input.taxNumber || '', PaymentTerms: input.paymentTerms || '',
    OpeningBalance: opening, CurrentBalance: opening, Active: true, CreatedDate: nowIso()
  });
  logAudit(userId, 'Suppliers', 'CREATE', id);
  return ok({ supplierId: id });
  })();
}

function updateSupplier(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_SUPPLIERS);
  updateRowById(SHEETS.SUPPLIERS, 'SupplierID', input.supplierId, {
    SupplierName: input.supplierName, ContactPerson: input.contactPerson || '', Phone: input.phone || '',
    Email: input.email || '', Address: input.address || '', TaxNumber: input.taxNumber || '',
    PaymentTerms: input.paymentTerms || ''
  });
  logAudit(userId, 'Suppliers', 'UPDATE', input.supplierId);
  return ok({});
  })();
}

// Adjusts a supplier's running balance — positive = they owe us more
// (e.g. a new purchase on credit), negative = a payment reducing what we owe them.
function adjustSupplierBalance(supplierId, delta) {
  var supplier = findRowById(SHEETS.SUPPLIERS, 'SupplierID', supplierId);
  if (!supplier) return;
  updateRowById(SHEETS.SUPPLIERS, 'SupplierID', supplierId, { CurrentBalance: Number(supplier.CurrentBalance || 0) + delta });
}

// ── Customers ─────────────────────────────────────────────────────────────
function getCustomers(userId) {
  return safe(function () {
  requireUser(userId);
  return ok({ customers: readTable(SHEETS.CUSTOMERS).rows });
  })();
}

function createCustomer(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_CUSTOMERS);
  if (!input.fullName) return fail('Customer name is required.');
  var id = nextId('CUST', SHEETS.CUSTOMERS, 'CustomerID');
  appendRow(SHEETS.CUSTOMERS, {
    CustomerID: id, FullName: input.fullName, Phone: input.phone || '', Email: input.email || '',
    Address: input.address || '', LoyaltyPoints: 0, CreditBalance: 0, CreatedDate: nowIso()
  });
  logAudit(userId, 'Customers', 'CREATE', id);
  return ok({ customerId: id });
  })();
}

function updateCustomer(userId, input) {
  return safe(function () {
  authorize(userId, PERMISSIONS.MANAGE_CUSTOMERS);
  updateRowById(SHEETS.CUSTOMERS, 'CustomerID', input.customerId, {
    FullName: input.fullName, Phone: input.phone || '', Email: input.email || '', Address: input.address || ''
  });
  logAudit(userId, 'Customers', 'UPDATE', input.customerId);
  return ok({});
  })();
}