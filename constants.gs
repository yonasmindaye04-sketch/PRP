// ============================================================================
//  PHARMACY ERP — v1
//  constants.gs — configuration & schema (single source of truth)
// ============================================================================

var SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID_HERE';
var APP_NAME = 'Pharmacy ERP';

// ── Sheet names ───────────────────────────────────────────────────────────
var SHEETS = {
  SETTINGS:            'Settings',
  BUSINESS_INFO:       'BusinessInfo',
  USERS:               'Users',
  ROLES:               'Roles',
  PERMISSIONS:         'Permissions',
  ROLE_PERMISSIONS:    'RolePermissions',
  CATEGORIES:          'Categories',
  PRODUCTS:            'Products',
  BATCHES:             'Batches',
  INVENTORY:           'Inventory',
  STOCK_MOVEMENTS:     'StockMovements',
  SUPPLIERS:           'Suppliers',
  CUSTOMERS:           'Customers',
  PURCHASES:           'Purchases',
  PURCHASE_ITEMS:      'PurchaseItems',
  SALES:               'Sales',
  SALE_ITEMS:          'SaleItems',
  RETURNS:             'Returns',
  EXPENSES:            'Expenses',
  INCOME:              'Income',
  PAYMENTS:            'Payments',
  CASH_DRAWER:         'CashDrawer',
  PRESCRIPTIONS:       'Prescriptions',
  PRESCRIPTION_ITEMS:  'PrescriptionItems',
  NOTIFICATIONS:       'Notifications',
  AUDIT_LOGS:          'AuditLogs',
  ACTIVITY_LOG:        'ActivityLog',
  DASHBOARD_CACHE:     'DashboardCache'
};

// ── Column headers (schema) for every table ───────────────────────────────
var HEADERS = {
  Settings:      ['Setting', 'Value'],
  BusinessInfo:  ['BusinessName', 'Owner', 'LicenseNumber', 'TaxID', 'Phone', 'Email', 'Address', 'LogoURL'],

  Users:         ['UserID', 'FullName', 'Username', 'PasswordHash', 'RoleID', 'Phone', 'Email', 'Active', 'LastLogin', 'CreatedDate'],
  Roles:         ['RoleID', 'RoleName', 'Description'],
  Permissions:   ['PermissionID', 'PermissionName', 'Description'],
  RolePermissions: ['RoleID', 'PermissionID'],

  Categories:    ['CategoryID', 'CategoryName', 'Description', 'Active'],

  Products: ['ProductID', 'Barcode', 'ProductName', 'GenericName', 'Brand', 'CategoryID', 'Unit',
             'Strength', 'DosageForm', 'PurchasePrice', 'SellingPrice', 'TaxRate', 'MinimumStock',
             'MaximumStock', 'ReorderLevel', 'SupplierID', 'Active', 'CreatedDate', 'UpdatedDate', 'CreatedBy'],

  Batches: ['BatchID', 'ProductID', 'BatchNumber', 'ManufacturingDate', 'ExpiryDate', 'Quantity',
            'PurchasePrice', 'SellingPrice', 'SupplierID'],

  Inventory: ['ProductID', 'CurrentStock', 'ReservedStock', 'AvailableStock', 'LastUpdated'],

  StockMovements: ['MovementID', 'Date', 'ProductID', 'BatchID', 'Type', 'Quantity', 'PreviousStock',
                   'NewStock', 'ReferenceType', 'ReferenceID', 'Remarks', 'UserID'],

  Suppliers: ['SupplierID', 'SupplierName', 'ContactPerson', 'Phone', 'Email', 'Address', 'TaxNumber',
              'PaymentTerms', 'OpeningBalance', 'CurrentBalance', 'Active', 'CreatedDate'],

  Customers: ['CustomerID', 'FullName', 'Phone', 'Email', 'Address', 'LoyaltyPoints', 'CreditBalance', 'CreatedDate'],

  Purchases: ['PurchaseID', 'PurchaseDate', 'SupplierID', 'InvoiceNumber', 'TotalAmount', 'Discount',
              'Tax', 'GrandTotal', 'PaymentStatus', 'PaidAmount', 'Balance', 'ReceivedBy', 'Notes'],

  PurchaseItems: ['PurchaseItemID', 'PurchaseID', 'ProductID', 'BatchID', 'Quantity', 'PurchasePrice',
                  'SellingPrice', 'Total'],

  Sales: ['SaleID', 'SaleDate', 'InvoiceNumber', 'CustomerID', 'CashierID', 'TotalAmount', 'Discount',
          'Tax', 'GrandTotal', 'PaymentMethod', 'AmountReceived', 'ChangeGiven', 'Status'],

  SaleItems: ['SaleItemID', 'SaleID', 'ProductID', 'BatchID', 'Quantity', 'UnitPrice', 'Discount', 'Tax', 'Total'],

  Returns: ['ReturnID', 'Date', 'SaleID', 'ProductID', 'Quantity', 'Reason', 'Amount', 'ApprovedBy'],

  Expenses: ['ExpenseID', 'ExpenseDate', 'Category', 'Description', 'Amount', 'PaymentMethod', 'ApprovedBy', 'CreatedBy'],

  Income: ['IncomeID', 'Date', 'Source', 'Description', 'Amount', 'ReceivedBy'],

  Payments: ['PaymentID', 'Date', 'SupplierID', 'PurchaseID', 'Amount', 'Method', 'Reference', 'ReceivedBy'],

  CashDrawer: ['DrawerID', 'Date', 'CashierID', 'OpeningBalance', 'CashSales', 'CardSales', 'MobileMoney',
               'Expenses', 'ClosingBalance', 'Difference', 'ClosedBy'],

  Prescriptions: ['PrescriptionID', 'CustomerID', 'DoctorName', 'Hospital', 'Date', 'Notes'],
  PrescriptionItems: ['PrescriptionItemID', 'PrescriptionID', 'ProductID', 'Quantity', 'Instructions'],

  Notifications: ['NotificationID', 'Type', 'Title', 'Message', 'UserID', 'Status', 'Date'],

  AuditLogs: ['LogID', 'DateTime', 'UserID', 'Module', 'Action', 'RecordID', 'OldValue', 'NewValue', 'IP', 'Device'],

  ActivityLog: ['ActivityID', 'UserID', 'Activity', 'Date', 'Time'],

  DashboardCache: ['Metric', 'Value', 'LastUpdated']
};

// ── Well-known role & permission IDs (must match the seeded sheet rows) ──
var ROLE_IDS = {
  OWNER:      'ROLE_OWNER',
  PHARMACIST: 'ROLE_PHARMACIST',
  CASHIER:    'ROLE_CASHIER'
};

var PERMISSIONS = {
  VIEW_DASHBOARD:      'PERM_VIEW_DASHBOARD',
  VIEW_PRODUCTS:       'PERM_VIEW_PRODUCTS',
  CREATE_PRODUCT:      'PERM_CREATE_PRODUCT',
  EDIT_PRODUCT:        'PERM_EDIT_PRODUCT',
  DELETE_PRODUCT:      'PERM_DELETE_PRODUCT',
  ADJUST_STOCK:        'PERM_ADJUST_STOCK',
  MANAGE_CATEGORIES:   'PERM_MANAGE_CATEGORIES',
  SELL:                'PERM_SELL',
  VIEW_SALES:          'PERM_VIEW_SALES',
  VIEW_OWN_SALES:      'PERM_VIEW_OWN_SALES',
  REFUND:              'PERM_REFUND',
  MANAGE_PURCHASES:    'PERM_MANAGE_PURCHASES',
  MANAGE_SUPPLIERS:    'PERM_MANAGE_SUPPLIERS',
  MANAGE_CUSTOMERS:    'PERM_MANAGE_CUSTOMERS',
  MANAGE_EXPENSES:     'PERM_MANAGE_EXPENSES',
  MANAGE_CASHDRAWER:   'PERM_MANAGE_CASHDRAWER',
  VIEW_PROFIT:         'PERM_VIEW_PROFIT',
  VIEW_REPORTS:        'PERM_VIEW_REPORTS',
  MANAGE_USERS:        'PERM_MANAGE_USERS',
  VIEW_AUDIT_LOGS:     'PERM_VIEW_AUDIT_LOGS',
  MANAGE_SETTINGS:     'PERM_MANAGE_SETTINGS'
};

var CACHE_TTL_SECONDS = 1800; // 30 minutes — used for permissions & settings cache
