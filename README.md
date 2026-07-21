# Pharmacy ERP

A full-featured pharmacy management system built on **Google Sheets + Apps Script** — a zero-infrastructure ERP that runs entirely inside Google Workspace. Sheets is the database, Apps Script is the backend, and a single-page HTML/JS frontend talks to it through `google.script.run`.

---

## Features

| Module | What it does |
|---|---|
| **Authentication & Roles** | Login with SHA-256 password hashing. Three data-driven roles (Owner, Pharmacist, Cashier) with 21 granular permissions stored in the sheet, not in code. |
| **Dashboard** | Today's sales, transactions, expenses, profit, low-stock alerts, expiry alerts. Sales trend, top products, category breakdown, month-over-month and year-over-year comparison charts — all dependency-free. |
| **POS (Point of Sale)** | Tap-to-add product grid with search & category filter. Cart with qty controls, **per-item margin selection** (configurable presets from Settings), discount, tax, customer selection, and three payment methods (Cash / Card / Mobile Money). FEFO batch deduction. |
| **Pill Selling** | Products can be configured to sell by individual pill. The POS cart shows **Units + Pills inputs** for sell-by-pill products, letting the pharmacist enter partial strips. Prices are calculated per-pill as a fraction of the unit price. The system tracks loose pills per product, uses FEFO to break whole strips when loose pills run out, and displays pill-level stock in the POS grid. |
| **Margin Management** | Each product has a configurable default margin (%). The POS cart shows a margin dropdown per line item (populated from margin presets in Settings). For standard products, price = `PurchasePrice × (1 + margin/100)`. For sell-by-pill products, this is divided by PillsPerUnit to get the per-pill price. |
| **Sales History** | Transaction list with drill-down detail view showing margin used per item, and item-level return initiation. Printable receipts via `@media print`. |
| **Products & Inventory** | Full product catalog (name, generic, brand, category, strength, dosage form, pricing, reorder levels, default margin, pills-per-unit, sell-by-pill flag). Stock is never edited directly — every change goes through Batches and is logged in StockMovements. |
| **Purchases** | Multi-line purchase orders against suppliers. Each line creates a Batch, bumps Inventory, logs a StockMovement, and adjusts the supplier's running balance. Soft-delete (Owner-only) with stock reversal. Detail view shows supplier contact info and payment history. |
| **Returns** | Sale returns with reason codes. Resalable items go back as a new batch; damaged/expired items are logged but not restocked. Refund amount is tracked against the cash drawer. |
| **Suppliers** | Master data with contact info, tax number, payment terms, and a running balance that tracks credit/debit. |
| **Customers** | Customer records with loyalty points and credit balance fields. |
| **Finance** | Expenses (categorized), non-sales Income, and Supplier Payments (optionally tied to a specific purchase order). |
| **Cash Drawer** | Shift-based cash management. Start shift with opening balance; every sale bumps the running totals. End shift records counted cash, computes the difference, and snapshots itemized ShiftSales. |
| **Users** | Staff management — create, enable/disable, reset passwords. Role assignment with permission-gated UI. |
| **Settings** | Business info (name, license, tax ID, address) and system defaults (currency, VAT rate, low-stock threshold, expiry alert days, receipt header/footer, **margin presets**). |
| **Audit Log** | Every significant action (login, create, update, delete, sale, purchase, payment, stock change) is logged with timestamp, user, and details. |

---

## Architecture

```
Browser (single-page HTML/CSS/JS)
        |
   google.script.run  (Apps Script's built-in RPC)
        |
Apps Script Backend  — one .gs file per domain
        |
        +-- constants.gs       Config, sheet names, column schemas, role/permission IDs
        +-- database.gs        Generic CRUD over Google Sheets (the ONLY file that touches Range objects)
        +-- auth.gs            Login + data-driven permission checks (cached 30 min)
        +-- utilities.gs       ID generation, SHA-256 hashing, audit logging, safe() wrapper, response helpers
        +-- setup.gs           One-time initialization (sheets, admin user, sample products)
        +-- products.gs        Product catalog + batches + inventory rollup + FEFO deduction + pill selling
        +-- sales.gs           POS checkout with FEFO, tax, discount, dynamic pricing, cash drawer bump
        +-- purchases.gs       Purchase orders → batches → stock → supplier balance
        +-- returns.gs         Sale returns → restock/discard → refund
        +-- finance.gs         Expenses, income, supplier payments, cash drawer shift management
        +-- masters.gs         Categories, Suppliers, Customers CRUD
        +-- users.gs           User management (create, list, enable/disable, password reset)
        +-- settings.gs        Settings (key/value) + BusinessInfo, cached
        +-- dashboard.gs       Summary metrics, charts, alerts, profit, period comparisons
        +-- code.gs            Web app entry point (doGet)
        +-- Index.html         Single-page frontend (~1870 lines)
        |
Google Sheets  — 29 sheets used as database tables
```

---

## Project Structure

| File | Lines | Purpose |
|---|---|---|
| `constants.gs` | 140 | All configuration: spreadsheet ID, sheet names, column headers (schema), role IDs, 21 permission IDs, cache TTL |
| `database.gs` | 129 | `readTable`, `appendRow`, `appendRows`, `findRowById`, `findRows`, `updateRowById`, `upsertRow`, `deleteRowById`, schema migration |
| `auth.gs` | 75 | `login`, `requireUser`, `getRolePermissionsMap`, `hasPermission`, `authorize`, `clearPermissionCache` |
| `utilities.gs` | 65 | `nextId`, `nowIso`, `hashPassword` (SHA-256), `logAudit`, `ok`, `fail`, `safe` (try/catch wrapper) |
| `setup.gs` | 60 | `initializeSystem` (run once), `seedProduct`, `addOpeningBatch` |
| `products.gs` | 248 | `getProducts`, `createProduct`, `updateProduct`, `deleteProduct`, `getLowStockProducts`, `getExpiringBatches`, `receiveBatch`, `addOpeningBatch`, `recalculateInventory`, `deductStockFEFO`, `deductPillsFEFO` |
| `sales.gs` | 120 | `createSale` (cart-based, FEFO, dynamic pricing, pill support), `cartTotalQty`, `round2`, `getSales`, `getSaleDetails` |
| `purchases.gs` | 176 | `createPurchase` (multi-line), `getPurchases`, `getPurchaseDetails` (with supplier details + payment history), `deletePurchase` (Owner-only, with stock reversal) |
| `returns.gs` | 63 | `createReturn` (restock or discard), `getReturns` |
| `finance.gs` | 240 | `createExpense`, `getExpenses`, `createIncome`, `getIncome`, `createPayment`, `getPayments`, `startShift`, `endShift`, `getCurrentDrawer`, `bumpOpenDrawer`, `getShiftHistory`, `getShiftDetails` |
| `masters.gs` | 122 | `getCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `getSuppliers`, `createSupplier`, `updateSupplier`, `adjustSupplierBalance`, `getCustomers`, `createCustomer`, `updateCustomer` |
| `users.gs` | 62 | `createUser`, `getUsers`, `setUserActive`, `resetUserPassword` |
| `settings.gs` | 46 | `getSettingsMap`, `getSettings`, `updateSettings`, `updateBusinessInfo` |
| `dashboard.gs` | 229 | `getDashboardSummary`, `getSalesTrend`, `getTopProducts`, `getCategoryBreakdown`, `getPeriodComparison`, `getProfitTrend` |
| `code.gs` | 24 | `doGet` (serves Index.html), `tempCreateAdmin` |
| `Index.html` | ~1940 | Single-page frontend: login, app shell with sidebar nav, 11 views, modals, POS with margin dropdowns, pill-aware Units+Pills inputs, receipt printing |
| `inventory.gs` | 10 | **Deprecated** — empty file kept as placeholder. All functionality superseded by `products.gs`. |

---

## Database (29 Sheets)

The spreadsheet (`Pharmacy_Database_v1.xlsx`) is the database. Every sheet has a frozen header row. IDs are foreign keys throughout.

### Config & Auth
- **Settings** — key/value pairs (Currency, VATRate, LowStockAlertThreshold, ExpiryAlertDays, ReceiptHeader, ReceiptFooter, **MarginPresets**)
- **BusinessInfo** — single row (BusinessName, Owner, LicenseNumber, TaxID, Phone, Email, Address, LogoURL)
- **Users** — UserID, FullName, Username, PasswordHash (SHA-256), RoleID, Active, LastLogin
- **Roles** — RoleID, RoleName, Description (seeded: ROLE_OWNER, ROLE_PHARMACIST, ROLE_CASHIER)
- **Permissions** — PermissionID, PermissionName, Description (21 permissions)
- **RolePermissions** — RoleID → PermissionID mapping (data-driven, not hardcoded)

### Catalog
- **Categories** — CategoryID, CategoryName, Description, Active
- **Products** — ProductID (MED000001), SKU, Barcode, ProductName, GenericName, Brand, CategoryID, Unit, Strength, DosageForm, PurchasePrice, SellingPrice, TaxRate, **DefaultMargin** (%), **PillsPerUnit**, **SellByPill** (boolean), MinimumStock, MaximumStock, ReorderLevel, SupplierID, Active
- **Batches** — BatchID (BAT000001), ProductID, BatchNumber, ManufacturingDate, ExpiryDate, Quantity, PurchasePrice, SellingPrice, SupplierID
- **Inventory** — ProductID, CurrentStock, **LoosePills**, **LoosePillsBatchID**, ReservedStock, AvailableStock, LastUpdated (derived rollup, never edited directly)

### Transactions
- **StockMovements** — MovementID, Date, ProductID, BatchID, Type, Quantity, PreviousStock, NewStock, ReferenceType, ReferenceID, Remarks, UserID
- **Purchases** — PurchaseID (PUR000001), PurchaseDate, SupplierID, InvoiceNumber, TotalAmount, Discount, Tax, GrandTotal, PaymentStatus (Paid/Partial/Unpaid), PaidAmount, Balance, ReceivedBy, RecordStatus (Active/Deleted), DeletedBy, DeletedReason
- **PurchaseItems** — PurchaseItemID, PurchaseID, ProductID, BatchID, Quantity, PurchasePrice, SellingPrice, Total
- **Sales** — SaleID (SALE000001), SaleDate, InvoiceNumber, CustomerID, CashierID, TotalAmount, Discount, Tax, GrandTotal, PaymentMethod, AmountReceived, ChangeGiven, Status
- **SaleItems** — SaleItemID, SaleID, ProductID, BatchID, Quantity, UnitPrice, **MarginUsed** (%), Discount, Tax, Total
- **Returns** — ReturnID (RET000001), Date, SaleID, ProductID, Quantity, Reason, Amount, ApprovedBy

### Finance
- **Expenses** — ExpenseID (EXP000001), ExpenseDate, Category, Description, Amount, PaymentMethod, CreatedBy
- **Income** — IncomeID (INC000001), Date, Source, Description, Amount, ReceivedBy
- **Payments** — PaymentID (PAY000001), Date, SupplierID, PurchaseID, Amount, Method, Reference, ReceivedBy
- **CashDrawer** — DrawerID (DRW000001), Date, CashierID, OpeningBalance, CashSales, CardSales, MobileMoney, Expenses, ClosingBalance, Difference, ClosedBy, OpenedAt, ClosedAt
- **ShiftSales** — ShiftSaleID, DrawerID, CashierID, ProductID, ProductName, QuantitySold, Revenue

### Reference (schema-ready, not yet wired to UI)
- **Suppliers** — SupplierID (SUP000001), SupplierName, ContactPerson, Phone, Email, Address, TaxNumber, PaymentTerms, OpeningBalance, CurrentBalance, Active
- **Customers** — CustomerID (CUST000001), FullName, Phone, Email, Address, LoyaltyPoints, CreditBalance
- **Prescriptions** — PrescriptionID, CustomerID, DoctorName, Hospital, Date, Notes
- **PrescriptionItems** — PrescriptionItemID, PrescriptionID, ProductID, Quantity, Instructions

### Logging
- **Notifications** — NotificationID, Type, Title, Message, UserID, Status, Date
- **AuditLogs** — LogID, DateTime, UserID, Action, Details
- **ActivityLog** — ActivityID, UserID, Activity, Date, Time
- **DashboardCache** — Metric, Value, LastUpdated

---

## Setup (5 minutes)

1. **Create the database.** Upload `Pharmacy_Database_v1.xlsx` to Google Drive and open it as a Google Sheet. Copy the spreadsheet ID from the URL (the string between `/d/` and `/edit`).

2. **Create the Apps Script project.** In the Sheet: Extensions → Apps Script. Delete the default `Code.gs` content.

3. **Copy in the files.** Create each `.gs` file and an HTML file named `Index` in the Apps Script editor, pasting in the matching contents. Do **not** create `inventory.gs` — it is deprecated.

4. **Paste your Spreadsheet ID** into `SPREADSHEET_ID` at the top of `constants.gs`.

5. **Run `initializeSystem` once.** In the Apps Script editor, pick `initializeSystem` from the function dropdown and click Run. Approve the permissions prompt. Check View → Logs — it verifies every sheet/header exists, warns if Roles or RolePermissions are empty, and creates the default admin login (`admin` / `ChangeMe123`) with 3 sample products if Users is empty.

6. **Deploy → New deployment → Web app.** Execute as "Me", access "Anyone with the link" (or "Anyone within [your org]" on Workspace). Open the resulting URL.

7. **Log in as `admin` / `ChangeMe123`**, then go to Users and create real Owner/Pharmacist/Cashier logins. Change the default admin password by editing the Users sheet's PasswordHash column directly (or call `hashPassword('newpass')` in the script editor).

---

## Key Design Decisions

### Stock is never edited directly
Every quantity change goes through `receiveBatch()` or `deductStockFEFO()` / `deductPillsFEFO()`, which write to the `Batches` table, recalculate `Inventory.CurrentStock` from the sum of batch quantities, and append a `StockMovements` row. This means the stock ledger is always complete and traceable.

### FEFO (First-Expire-First-Out)
When selling, batches are sorted by expiry date ascending and stock is deducted from the soonest-to-expire batch first. Each `SaleItems` row records which `BatchID` supplied its units — so a recalled batch can be traced to the exact sales that received it.

### Per-pill FEFO
For products configured to sell by pill (`SellByPill = true`), the system first uses loose pills from an already-broken strip (tracked in `Inventory.LoosePills`), then breaks new whole units via `deductStockFEFO` from the soonest-expiring batch. The remaining pills are stored back as loose pills with their batch ID for traceability.

### Per-product margin pricing
Each product has a `DefaultMargin` (%) stored in the Products sheet. When added to the POS cart, the selling price is calculated as `PurchasePrice × (1 + margin/100)`. For sell-by-pill products, this price is divided by `PillsPerUnit` to get the per-pill price. Cashiers can adjust the margin per line item from configurable presets (stored in `Settings.MarginPresets`, e.g. "20,25,30"). The `MarginUsed` is recorded on each `SaleItems` row for profitability analysis.

### Permissions are data, not code
Roles, Permissions, and RolePermissions live in sheets. The `authorize(userId, permissionId)` function looks up the user's role, then checks the cached role→permissions map. You can add or modify roles by editing sheets — no code redeployment needed. Cache expires after 30 minutes or on explicit `clearPermissionCache()`.

### Database layer is the swap seam
`database.gs` is the only file that touches `Range` objects. Every other module reads/writes through its functions (`readTable`, `appendRow`, `updateRowById`, etc.). To migrate from Sheets to Cloud SQL or Firestore, you rewrite `database.gs` alone.

### LockService for concurrency
`createSale`, `createPurchase`, `deletePurchase`, and `endShift` all acquire a `ScriptLock` to prevent two concurrent operations from overselling the same stock or double-ending a shift.

### Soft deletes
Products are deactivated (Active = false), not row-deleted, so sales history and audit logs remain intact. Purchases use a `RecordStatus` field (`Active` → `Deleted`) with a required reason and who-deleted tracking.

---

## Roadmap

| Phase | Status |
|---|---|
| Core infrastructure (auth, database, roles, permissions) | Done |
| Product catalog with categories | Done |
| Batch tracking with expiry dates | Done |
| FEFO stock deduction with movement logging | Done |
| POS with cart, tax, discount, payment methods | Done |
| Per-product margin pricing with configurable presets | Done |
| Pill-level selling with FEFO strip breaking | Done |
| Sales history with detail view | Done |
| Purchase orders with supplier balance | Done |
| Returns (restock or discard) | Done |
| Cash drawer shift management | Done |
| Expenses, income, supplier payments | Done |
| Customer management | Done |
| Dashboard with charts and alerts | Done |
| Receipt printing | Done |
| Prescriptions module | Schema ready, UI deferred |
| Notifications as persisted inbox | Schema ready, UI deferred |
| DashboardCache (write-on-change rollups) | Schema ready, not yet used |
| Multi-branch support | Deferred |
| Barcode scanning hardware | Deferred |
| Receipt printer integration | Deferred |
