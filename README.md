# Pharmacy ERP

A full-featured pharmacy management system built on **Google Sheets + Apps Script** — a zero-infrastructure ERP that runs entirely inside Google Workspace. Sheets is the database, Apps Script is the backend, and a single-page HTML/JS frontend talks to it through `google.script.run`.

---

## Features

| Module | What it does |
|---|---|
| **Authentication & Roles** | Login with SHA-256 password hashing. Three data-driven roles (Owner, Pharmacist, Cashier) with 21 granular permissions stored in the sheet, not in code. |
| **Dashboard** | Today''s sales, transactions, expenses, profit, low-stock alerts, expiry alerts. Sales trend, top products, category breakdown, month-over-month and year-over-year comparison charts. Low-stock threshold uses per-product ReorderLevel when set and > 0, otherwise falls back to the global LowStockAlertThreshold from Settings. |
| **POS (Point of Sale)** | Tap-to-add product grid with search and category filter. Cart with qty controls, custom free-text margin input (type any margin %, not just preset values), discount, tax, customer selection, and three payment methods (Cash / Card / Mobile Money). FEFO batch deduction. |
| **Pill Selling** | Products can be configured to sell by individual pill. The POS cart shows Units + Pills dual inputs for sell-by-pill products, letting the pharmacist enter partial strips naturally (e.g. 1 unit + 4 pills). The per-pill price is automatically derived as SellingPrice divided by PillsPerUnit. The system tracks loose pills per product with FEFO batch traceability. |
| **Pill Product Configuration** | The Add/Edit Product form has a dedicated interactive pill configuration panel with a toggle checkbox. When enabled it reveals a clearly-labelled Number of pills in 1 sealed unit field and a live Price Preview card that auto-calculates per-pill price, cost-per-pill, margin %, and a customer example as the pharmacist types — preventing data entry errors. |
| **Auto Price Update on Restock** | When receiving a purchase at a higher unit cost than the current catalog price, the system automatically updates the product''s PurchasePrice and recalculates SellingPrice using the product''s DefaultMargin (NewCost multiplied by (1 + DefaultMargin/100)). If a selling price is manually typed in the purchase form, it takes priority. |
| **Custom Profit Margin** | Cashiers can type any custom margin % (e.g. 12.5, 42) directly into the margin input in the POS cart. The unit price and subtotal update live. |
| **Product Filters** | The Products view supports three simultaneous filters: text search (by product name or generic name), category dropdown, and stock status (All / In stock / Low stock / Out of stock). All three work in combination. |
| **Margin Management** | Each product has a configurable default margin (%). For standard products, price = PurchasePrice times (1 + margin/100). For sell-by-pill products, this is divided by PillsPerUnit to get the per-pill price. The MarginUsed is recorded on each SaleItems row for profitability analysis. |
| **Sales History** | Transaction list with drill-down detail view showing margin used per item, and item-level return initiation. Printable receipts via @media print. |
| **Products & Inventory** | Full product catalog (name, generic, brand, category, strength, dosage form, pricing, reorder levels, default margin, pills-per-unit, sell-by-pill flag). Stock is never edited directly — every change goes through Batches and is logged in StockMovements. |
| **Purchases** | Multi-line purchase orders against suppliers. Each line creates a Batch, bumps Inventory, logs a StockMovement, adjusts the supplier''s running balance, and auto-updates catalog prices if the new cost is higher. Soft-delete (Owner-only) with stock reversal. |
| **Returns** | Sale returns with reason codes. Resalable items go back as a new batch; damaged/expired items are logged but not restocked. Refund amount is tracked against the cash drawer. |
| **Suppliers** | Master data with contact info, tax number, payment terms, and a running balance that tracks credit/debit. |
| **Customers** | Customer records with loyalty points and credit balance fields. |
| **Finance** | Expenses (categorized), non-sales Income, and Supplier Payments (optionally tied to a specific purchase order). |
| **Cash Drawer** | Shift-based cash management. Start shift with opening balance; every sale bumps the running totals. End shift records counted cash, computes the difference, and snapshots itemized ShiftSales. |
| **Users** | Staff management — create, enable/disable, reset passwords. Role assignment with permission-gated UI. |
| **Settings** | Business info (name, license, tax ID, address) and system defaults (currency, VAT rate, low-stock threshold, expiry alert days, receipt header/footer, margin presets). |
| **Audit Log** | Every significant action (login, create, update, delete, sale, purchase, payment, stock change) is logged with timestamp, user, and details. |

---

## Architecture

`
Browser (single-page HTML/CSS/JS)
        |
   google.script.run  (Apps Script built-in RPC)
        |
Apps Script Backend  — one .gs file per domain
        |
        +-- constants.gs       Config, sheet names, column schemas, role/permission IDs
        +-- database.gs        Generic CRUD over Google Sheets (the ONLY file that touches Range objects)
        +-- auth.gs            Login + data-driven permission checks (cached 30 min)
        +-- utilities.gs       ID generation, SHA-256 hashing, audit logging, safe() wrapper
        +-- setup.gs           One-time initialization (sheets, admin user, sample products)
        +-- products.gs        Product catalog + batches + inventory rollup + FEFO + pill selling
        +-- sales.gs           POS checkout with FEFO, tax, discount, dynamic pricing, cash drawer bump
        +-- purchases.gs       Purchase orders → batches → stock → supplier balance + auto price update
        +-- returns.gs         Sale returns → restock/discard → refund
        +-- finance.gs         Expenses, income, supplier payments, cash drawer shift management
        +-- masters.gs         Categories, Suppliers, Customers CRUD
        +-- users.gs           User management (create, list, enable/disable, password reset)
        +-- settings.gs        Settings (key/value) + BusinessInfo, cached
        +-- dashboard.gs       Summary metrics, charts, alerts, profit, period comparisons
        +-- code.gs            Web app entry point (doGet)
        +-- Index.html         Single-page frontend (~1944 lines)
        |
Google Sheets  — 29 sheets used as database tables
`

---

## Project Structure

| File | Purpose |
|---|---|
| `constants.gs` | All configuration: spreadsheet ID, sheet names, column headers (schema), role IDs, 21 permission IDs |
| `database.gs` | readTable, appendRow, appendRows, findRowById, findRows, updateRowById, upsertRow, deleteRowById, schema migration |
| `auth.gs` | login, requireUser, getRolePermissionsMap, hasPermission, authorize, clearPermissionCache |
| `utilities.gs` | nextId, nowIso, hashPassword (SHA-256), logAudit, ok, fail, safe (try/catch wrapper) |
| `setup.gs` | initializeSystem (run once), seedProduct, addOpeningBatch |
| `products.gs` | getProducts, createProduct, updateProduct, deleteProduct, getLowStockProducts, getExpiringBatches, receiveBatch, recalculateInventory, deductStockFEFO, deductPillsFEFO |
| `sales.gs` | createSale (cart-based, FEFO, dynamic pricing, pill support), getSales, getSaleDetails |
| `purchases.gs` | createPurchase (multi-line, auto price update on higher cost), getPurchases, getPurchaseDetails, deletePurchase |
| `returns.gs` | createReturn (restock or discard), getReturns |
| `finance.gs` | createExpense, createIncome, createPayment, startShift, endShift, getCurrentDrawer, bumpOpenDrawer, getShiftHistory, getShiftDetails |
| `masters.gs` | getCategories, createCategory, getSuppliers, createSupplier, adjustSupplierBalance, getCustomers, createCustomer |
| `users.gs` | createUser, getUsers, setUserActive, resetUserPassword |
| `settings.gs` | getSettingsMap, getSettings, updateSettings, updateBusinessInfo |
| `dashboard.gs` | getDashboardSummary (smart low-stock fallback), getSalesTrend, getTopProducts, getCategoryBreakdown, getPeriodComparison, getProfitTrend |
| `code.gs` | doGet (serves Index.html) |
| `Index.html` | Single-page frontend: login, 11 views, POS with custom margin input + Units+Pills dual inputs, product filters, pill config panel with live preview, receipt printing |
| `inventory.gs` | Deprecated — empty placeholder file |

---

## Key Design Decisions

### Stock is never edited directly
Every quantity change goes through receiveBatch() or deductStockFEFO() / deductPillsFEFO(), which write to Batches, recalculate Inventory.CurrentStock from the sum of batch quantities, and append a StockMovements row.

### FEFO (First-Expire-First-Out)
When selling, batches are sorted by expiry date ascending. Each SaleItems row records which BatchID supplied its units — so a recalled batch can be traced to the exact sales that received it.

### Per-pill FEFO
For SellByPill products, the system first uses loose pills from Inventory.LoosePills, then breaks new whole units via deductStockFEFO from the soonest-expiring batch. Leftover pills are stored back with their batch ID for traceability.

### Custom margin input
Cashiers can type any margin % into a free-text number input per cart line item. The price recalculates as PurchasePrice times (1 + margin/100). For pill products, this is further divided by PillsPerUnit. The MarginUsed value is permanently recorded in SaleItems.

### Automatic price update on restock
When createPurchase() finds a new purchasePrice greater than the catalog PurchasePrice, it automatically updates the product row: PurchasePrice = new cost, SellingPrice = new cost times (1 + DefaultMargin/100). Manual selling price in the form overrides the auto-calculation.

### Smart low-stock threshold with fallback
The low-stock check uses a two-tier threshold: a product''s own ReorderLevel if set and greater than 0; otherwise the global LowStockAlertThreshold from Settings. Products where ReorderLevel was saved as 0 (the default when left blank) correctly use the global threshold.

### Pill product configuration with live preview
The Add/Edit Product form includes a pill-selling configuration panel. When enabled, it shows a labelled PillsPerUnit input alongside a live Price Preview card showing per-pill price, cost-per-pill, margin %, and a customer example — preventing data entry errors.

### Permissions are data, not code
Roles, Permissions, and RolePermissions live in sheets. Cache expires after 30 minutes or on explicit clearPermissionCache().

### Database layer is the swap seam
database.gs is the only file that touches Range objects. To migrate from Sheets to another database, rewrite database.gs alone.

### LockService for concurrency
createSale, createPurchase, deletePurchase, and endShift all acquire a ScriptLock to prevent concurrent operations from overselling stock or double-ending a shift.

### Soft deletes
Products are deactivated (Active = false). Purchases use RecordStatus (Active / Deleted) with a required reason and who-deleted tracking.

---

## Roadmap

| Phase | Status |
|---|---|
| Core infrastructure (auth, database, roles, permissions) | Done |
| Product catalog with categories | Done |
| Batch tracking with expiry dates | Done |
| FEFO stock deduction with movement logging | Done |
| POS with cart, tax, discount, payment methods | Done |
| Per-product margin pricing | Done |
| Custom free-text margin input in POS cart | Done |
| Pill-level selling with FEFO strip breaking | Done |
| Units + Pills dual input in POS cart | Done |
| Interactive pill config panel with live price preview | Done |
| Product filters (search, category, stock status) | Done |
| Auto catalog price update on higher-cost restock | Done |
| Smart low-stock threshold (per-product + global fallback) | Done |
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
