# Pharmacy ERP — System Design

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (SPA)                        │
│  Index.html — ~1940 lines of vanilla HTML/CSS/JS        │
│  No framework, no build step, no external dependencies  │
│                                                         │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Login      │  │ App Shell  │  │ Modals           │  │
│  │ Screen     │  │ + Sidebar  │  │ (CRUD forms,     │  │
│  │            │  │ + 11 Views │  │  detail views)   │  │
│  └────────────┘  └────────────┘  └──────────────────┘  │
│                                                         │
│  call('functionName', userId, ...args)                  │
│       ↓ google.script.run (async RPC)                  │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              APPS SCRIPT BACKEND (.gs files)             │
│                                                         │
│  code.gs ─── doGet() serves Index.html                 │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ constants.gs │  │ database.gs  │  │ utilities.gs │  │
│  │ Schema, IDs, │  │ ONLY file    │  │ nextId, hash,│  │
│  │ permissions  │  │ touching     │  │ audit log,   │  │
│  │              │  │ Range objects│  │ safe(), ok() │  │
│  └─────────────┘  └──────────────┘  │ fail()       │  │
│                                      └──────────────┘  │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ auth.gs    │  │ setup.gs     │  │ settings.gs  │   │
│  │ Login +    │  │ initialize   │  │ Key/value +  │   │
│  │ data-driven│  │ System (run  │  │ BusinessInfo,│   │
│  │ permission │  │ once)        │  │ cached       │   │
│  │ checks     │  └──────────────┘  └──────────────┘   │
│  └────────────┘                                        │
│                                                         │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │products.gs │  │ sales.gs     │  │purchases.gs  │   │
│  │ Catalog +  │  │ POS + FEFO   │  │ PO → batches │   │
│  │ Batches +  │  │ batch pick + │  │ → stock →    │   │
│  │ Inventory  │  │ pill support +│  │ supplier bal │   │
│  │ + pill     │  │ dynamic      │  │ + supplier   │   │
│  │ deduction  │  │ pricing      │  │ details      │   │
│  └────────────┘  └──────────────┘  └──────────────┘   │
│                                                         │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │returns.gs  │  │ finance.gs   │  │ masters.gs   │   │
│  │ Restock or │  │ Expenses,    │  │ Categories,  │   │
│  │ discard +  │  │ Income,      │  │ Suppliers,   │   │
│  │ refund     │  │ Payments,    │  │ Customers    │   │
│  └────────────┘  │ Cash Drawer  │  └──────────────┘   │
│                   └──────────────┘                      │
│  ┌────────────┐  ┌──────────────┐                      │
│  │ users.gs   │  │dashboard.gs  │                      │
│  │ CRUD +     │  │ Metrics,     │                      │
│  │ enable/    │  │ charts,      │                      │
│  │ disable    │  │ alerts,      │                      │
│  └────────────┘  │ profit       │                      │
│                   └──────────────┘                      │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              GOOGLE SHEETS (29 tables)                  │
│  Each sheet = one database table                        │
│  Frozen header row = column schema                      │
│  IDs are foreign keys throughout                        │
│                                                         │
│  Config: Settings, BusinessInfo                         │
│  Auth:   Users, Roles, Permissions, RolePermissions     │
│  Catalog: Categories, Products, Batches, Inventory      │
│  Transactions: StockMovements, Purchases, PurchaseItems │
│                Sales, SaleItems, Returns                │
│  Finance: Expenses, Income, Payments, CashDrawer,       │
│           ShiftSales                                    │
│  Ref:    Suppliers, Customers, Prescriptions,           │
│          PrescriptionItems                              │
│  Logging: AuditLogs, ActivityLog, Notifications,        │
│           DashboardCache                                │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Module Breakdown

### 2.1 `constants.gs` — Single Source of Truth

Defines every constant the system references:

- **`SPREADSHEET_ID`** — the Google Sheet acting as the database
- **`SHEETS`** — map of logical names to sheet tab names (e.g., `SHEETS.PRODUCTS → 'Products'`)
- **`HEADERS`** — the exact column order for every sheet. This is the schema definition. If a new column is added, `ensureSheet()` in `database.gs` appends it automatically.
- **`ROLE_IDS`** — `ROLE_OWNER`, `ROLE_PHARMACIST`, `ROLE_CASHIER`
- **`PERMISSIONS`** — 21 permission constants (`PERM_VIEW_DASHBOARD`, `PERM_SELL`, `PERM_MANAGE_PURCHASES`, etc.)
- **`CACHE_TTL_SECONDS`** — 1800 (30 minutes), used for permissions and settings cache

Notable schema fields added for new features:
- **Products**: `DefaultMargin`, `PillsPerUnit`, `SellByPill`
- **Inventory**: `LoosePills`, `LoosePillsBatchID`
- **SaleItems**: `MarginUsed`

### 2.2 `database.gs` — Database Layer (the swap seam)

The only file that touches `SpreadsheetApp` Range objects. Every other module reads/writes through these functions:

| Function | Purpose |
|---|---|
| `ensureSheet(name)` | Creates the sheet with headers if missing. Appends new columns if `HEADERS` was updated. Schema check is cached for 6 hours per sheet. |
| `readTable(name)` | Reads the entire sheet into memory as an array of plain objects. Skips blank rows. Attaches `_row` (1-indexed row number) for `updateRowById`. |
| `appendRow(name, obj)` | Maps the object to the header column order and appends a row. |
| `appendRows(name, objs)` | Batch insert for multiple rows at once. |
| `findRowById(name, idField, idValue)` | Linear scan for a single row by ID. |
| `findRows(name, predicate)` | Filter all rows by a predicate function. |
| `updateRowById(name, idField, idValue, updates)` | Finds the row, then writes individual cells for each key in `updates`. |
| `upsertRow(name, idField, idValue, obj)` | Insert or update — returns `true` if inserted, `false` if updated. |
| `deleteRowById(name, idField, idValue)` | Hard-deletes the row from the sheet. |

**Migration path:** To swap Sheets for Cloud SQL/Firestore, rewrite only `database.gs` — all other modules consume these functions and never touch the spreadsheet directly.

### 2.3 `auth.gs` — Authentication & Permissions

```
login(username, password)
  → find user in Users sheet by Username
  → verify PasswordHash matches hashPassword(password)
  → update LastLogin timestamp
  → logAudit(userId, 'Logged in')
  → return { userId, name, roleId, roleName, permissions[] }

authorize(userId, permissionId)    ← called at top of every privileged function
  → requireUser(userId)            ← re-derives from sheet, not trusting the client
  → hasPermission(roleId, permId)  ← checks cached RolePermissions map
  → throws if denied (caught by safe() wrapper)
```

Permissions are **data-driven**: Roles, Permissions, and RolePermissions live in the sheet. The role→permissions map is cached in `CacheService` for 30 minutes. `clearPermissionCache()` invalidates immediately.

### 2.4 `utilities.gs` — Shared Helpers

| Function | Purpose |
|---|---|
| `nextId(prefix, sheetName, idField)` | Sequential, human-readable IDs (e.g., `MED000042`). Scans sheet for highest existing number. |
| `nowIso()` | Current timestamp in ISO format. |
| `hashPassword(plain)` | SHA-256 hash via `Utilities.computeDigest`. |
| `logAudit(userId, action, details)` | Writes to AuditLogs sheet with UUID, timestamp, user, action, details. |
| `ok(data)` | Returns `{ success: true, ...data }`. |
| `fail(message)` | Returns `{ success: false, message: '...' }`. |
| `safe(fn)` | Wraps a function body in try/catch. Returns a callable that catches exceptions and returns `fail()` instead of throwing. Used by every module function. |

### 2.5 `products.gs` — Product Catalog, Batches & Inventory

The most complex module. Three tables work together:

- **Products** — the catalog row (name, pricing, reorder levels, supplier, default margin, pill config)
- **Batches** — individual deliveries with their own expiry date and purchase price
- **Inventory** — a derived rollup: `CurrentStock = SUM(Batches.Quantity WHERE ProductID = X)`, plus `LoosePills` and `LoosePillsBatchID` for pill-selling products

**Key invariant:** `Inventory.CurrentStock` is **never edited directly**. Every stock change goes through:

1. A batch quantity change (via `receiveBatch` or `deductStockFEFO` or `deductPillsFEFO`)
2. `recalculateInventory()` recomputes from batches and writes the new total
3. A `StockMovements` row is appended describing the change

**FEFO deduction (`deductStockFEFO`):**
```
get batches for product WHERE Quantity > 0
sort by ExpiryDate ascending (soonest first)
for each batch:
  take = min(batch.Quantity, remaining)
  decrement batch.Quantity
  record {batchId, qty, unitCost} as consumed
  remaining -= take
if remaining > 0: throw "Not enough stock"
recalculateInventory(productId, ...)
return consumed[]
```

**Pill FEFO deduction (`deductPillsFEFO`):**
```
get product.PillsPerUnit, Inventory.LoosePills, Inventory.CurrentStock

Case 1: loose pills ≥ pills wanted
  → decrement LoosePills, log StockMovement, return

Case 2: need to break new strips
  → pillsStillNeeded = pillsWanted - loosePills
  → unitsToBreak = ceil(pillsStillNeeded / pillsPerUnit)
  → deductStockFEFO(productId, unitsToBreak, ...)  ← breaks whole units via FEFO
  → newLoosePills = loosePills + (unitsToBreak × pillsPerUnit) - pillsWanted
  → update Inventory.LoosePills and LoosePillsBatchID
  → return consumed[]
```

**getProducts return shape:**
```js
{
  ProductID, ProductName, CategoryName, PurchasePrice, SellingPrice,
  TaxRate, ReorderLevel, CurrentStock, Active, DefaultMargin,
  PillsPerUnit, SellByPill, LoosePills, LoosePillsBatchID,
  DisplayStock  // pills if SellByPill, units otherwise
}
```

### 2.6 `sales.gs` — Point of Sale

```
createSale(userId, cart[{productId, qty, unitPrice, marginUsed}], options)
  1. validate all cart items (product exists, enough stock)
     - for sell-by-pill products: checks stock in pills (CurrentStock × PillsPerUnit + LoosePills)
     - for normal products: checks CurrentStock
  2. compute line totals using the dynamic unitPrice from cart (not the catalog price)
  3. compute grandTotal = subtotal - discount + tax
  4. insert Sales row (SALE000001, timestamp, cashier, totals, payment method)
  5. for each cart item:
       if product.SellByPill:
         deductPillsFEFO(productId, qty, 'Sale', 'Sale', saleId, ...)
       else:
         deductStockFEFO(productId, qty, 'Sale', 'Sale', saleId, ...)
       for each consumed batch:
         insert SaleItems row with BatchID, UnitPrice, MarginUsed
  6. bumpOpenDrawer(cashierId, field, grandTotal)  ← updates running shift totals
  7. return { saleId, total, change }
```

**Dynamic pricing:** The cart sends `unitPrice` and `marginUsed` per item. The backend uses these instead of the catalog `SellingPrice`, enabling per-line margin selection at the POS.

**Concurrency:** `LockService.getScriptLock()` prevents two concurrent sales from overselling the same batch.

**SaleItems ↔ BatchID linkage:** Each SaleItem records which batch supplied its units, the unit price charged, and the margin used. This enables profitability analysis and batch traceability.

### 2.7 `purchases.gs` — Purchase Orders

```
createPurchase(userId, {supplierId, items[], discount, tax, paidAmount})
  1. validate supplier and all line items
  2. insert Purchases row (PUR000001, timestamp, totals, PaymentStatus)
  3. for each line item:
       receiveBatch(productId, qty, purchasePrice, sellingPrice, expiryDate, supplierId, 'Purchase', purchaseId, ...)
       → creates a Batches row with the delivery's expiry/cost
       → recalculates Inventory
       → appends StockMovements
       insert PurchaseItems row with BatchID
  4. adjustSupplierBalance(supplierId, grandTotal - paidAmount)  ← increases what we owe
```

**`getPurchaseDetails`** returns enriched data:
- Purchase header + all line items with product names
- Supplier contact details (phone, email, address, tax number, payment terms)
- Payment history with recorded-by user names
- Financial summary (totals, balance due)

**Soft delete (Owner-only):** `deletePurchase` reverses stock (reduces batch quantities, recalculates inventory), reverses the supplier balance for the unpaid portion, and marks `RecordStatus = 'Deleted'` with a required reason. Partial reversals are handled — if some of the batch was already sold, only the remaining quantity is reversed.

### 2.8 `returns.gs` — Sale Returns

```
createReturn(userId, saleId, productId, qty, reason)
  1. verify the original sale and sale item exist
  2. validate return quantity ≤ original quantity
  3. if resalable (not Damaged/Expired):
       receiveBatch(productId, returnQty, ...)  ← creates a new sellable batch
     else:
       append StockMovements with 0 quantity (logged but no stock added)
  4. insert Returns row (RET000001, amount, approvedBy)
  5. bumpOpenDrawer(cashierId, field, -refundAmount)  ← subtracts from shift totals
```

### 2.9 `finance.gs` — Expenses, Income, Payments & Cash Drawer

**Expenses / Income / Payments** are straightforward CRUD with audit logging.

**Cash Drawer** is shift-based:

```
startShift(userId, openingBalance)
  → insert CashDrawer row with OpeningBalance, all sale counters at 0

bumpOpenDrawer(userId, field, amount)  ← called automatically by sales.gs and returns.gs
  → finds the open shift row and increments the field (CashSales/CardSales/MobileMoney)

endShift(userId, countedCash)
  → compute expected = OpeningBalance + CashSales - Expenses
  → compute difference = countedCash - expected
  → snapshot all sales during the shift window into ShiftSales (itemized per product)
  → close the drawer row with ClosingBalance, Difference, ClosedAt
```

**ShiftSales** gives a permanent, itemized record of what each cashier sold during each shift — independent of the Sales table.

### 2.10 `dashboard.gs` — Analytics

Computed live from sheet data on each load (no rollup cache yet). Functions:

| Function | What it computes |
|---|---|
| `getDashboardSummary` | Today's sales total, transaction count, expenses, product count, low-stock count, expiry-soon count, today's profit (Owner/Pharmacist only) |
| `getSalesTrend(days)` | Daily sales totals for the last N days (powers the bar chart) |
| `getTopProducts(days, limit)` | Top-selling products by revenue over the last N days |
| `getCategoryBreakdown(days)` | Revenue grouped by category over the last N days |
| `getPeriodComparison` | Month-over-month and year-over-year revenue comparison with percentage change |
| `getProfitTrend(days)` | Daily profit (revenue − COGS − expenses) for the last N days |

Profit computation: for each sale item, the cost is `SaleItem.Quantity × Batch.PurchasePrice` (the batch's actual cost, not the product's current purchase price).

---

## 3. Data Model

### 3.1 Entity Relationships

```
Roles ──< RolePermissions >── Permissions
  │
  └──< Users
         │
         ├──< Sales >──< SaleItems >──< Batches
         │                  │              │
         │                  │              └──> Products
         │                  └──> Products
         ├──< Purchases >──< PurchaseItems >──< Batches
         ├──< Returns
         ├──< Expenses
         ├──< Income
         ├──< Payments
         └──< CashDrawer >──< ShiftSales

Products ──< Batches
    │            │
    │            └──> Inventory (derived)
    │                  ├── CurrentStock (sum of batch quantities)
    │                  ├── LoosePills (individual pills from broken strips)
    │                  └── LoosePillsBatchID (traceability for loose pills)
    ├──> Categories
    └──> Suppliers

Customers ──< Sales
Suppliers ──< Purchases
         ──< Payments
         ──< Batches
```

### 3.2 ID Generation

All IDs are sequential, human-readable, zero-padded to 6 digits:

| Table | Prefix | Example |
|---|---|---|
| Products | `MED` | MED000042 |
| Batches | `BAT` | BAT000015 |
| Users | `USR` | USR000003 |
| Roles | `ROLE` | ROLE_OWNER |
| Categories | `CAT` | CAT000001 |
| Suppliers | `SUP` | SUP000005 |
| Customers | `CUST` | CUST000012 |
| Purchases | `PUR` | PUR000008 |
| Sales | `SALE` | SALE000156 |
| Returns | `RET` | RET000004 |
| Expenses | `EXP` | EXP000020 |
| Income | `INC` | INC000003 |
| Payments | `PAY` | PAY000011 |
| CashDrawer | `DRW` | DRW000007 |
| StockMovements | UUID | (via `Utilities.getUuid()`) |
| AuditLogs | UUID | (via `Utilities.getUuid()`) |

`nextId(prefix, sheetName, idField)` scans the sheet for the highest existing number and returns the next one.

### 3.3 Concurrency Control

`LockService.getScriptLock()` is used in:
- `createSale` (15s timeout)
- `createPurchase` (15s timeout)
- `deletePurchase` (15s timeout)
- `endShift` (15s timeout)

---

## 4. Permission Model

### 4.1 Roles

| Role | ID | Typical access |
|---|---|---|
| Owner | `ROLE_OWNER` | Everything — full admin |
| Pharmacist | `ROLE_PHARMACIST` | View dashboard + profit, manage products/purchases/suppliers, sell, refund |
| Cashier | `ROLE_CASHIER` | View products, sell, view own sales, manage cash drawer |

### 4.2 Permissions (21 total)

| Permission | ID | Used in |
|---|---|---|
| View Dashboard | `PERM_VIEW_DASHBOARD` | `dashboard.gs` |
| View Products | `PERM_VIEW_PRODUCTS` | `products.gs`, `sales.gs` |
| Create Product | `PERM_CREATE_PRODUCT` | `products.gs` |
| Edit Product | `PERM_EDIT_PRODUCT` | `products.gs` |
| Delete Product | `PERM_DELETE_PRODUCT` | `products.gs` |
| Adjust Stock | `PERM_ADJUST_STOCK` | (reserved for future stock adjustment UI) |
| Manage Categories | `PERM_MANAGE_CATEGORIES` | `masters.gs` |
| Sell | `PERM_SELL` | `sales.gs` |
| View Sales | `PERM_VIEW_SALES` | `sales.gs` (all sales) |
| View Own Sales | `PERM_VIEW_OWN_SALES` | `sales.gs` (cashier's own) |
| Refund | `PERM_REFUND` | `returns.gs` |
| Manage Purchases | `PERM_MANAGE_PURCHASES` | `purchases.gs` |
| Manage Suppliers | `PERM_MANAGE_SUPPLIERS` | `masters.gs`, `finance.gs` |
| Manage Customers | `PERM_MANAGE_CUSTOMERS` | `masters.gs` |
| Manage Expenses | `PERM_MANAGE_EXPENSES` | `finance.gs` |
| Manage Cash Drawer | `PERM_MANAGE_CASHDRAWER` | `finance.gs` |
| View Profit | `PERM_VIEW_PROFIT` | `dashboard.gs` (profit numbers) |
| View Reports | `PERM_VIEW_REPORTS` | `finance.gs` (shift history) |
| Manage Users | `PERM_MANAGE_USERS` | `users.gs` |
| View Audit Logs | `PERM_VIEW_AUDIT_LOGS` | (defined, not yet wired to UI) |
| Manage Settings | `PERM_MANAGE_SETTINGS` | `settings.gs` |

### 4.3 Frontend Permission Gating

Navigation items have `data-perm` attributes. On login, the JS hides any nav button whose permission the user lacks:
```js
document.querySelectorAll('.nav-item[data-perm]').forEach(function(btn){
  btn.style.display = can(btn.getAttribute('data-perm')) ? 'flex' : 'none';
});
```

**Backend enforcement is independent** — even if the frontend is modified, every backend function calls `authorize(userId, permissionId)` which re-derives the user from the sheet and checks the permission.

### 4.4 Exceptions to Data-Driven Permissions

Purchase deletion is **hardcoded to Owner-only** regardless of the RolePermissions sheet:
```js
// purchases.gs
if (user.RoleID !== ROLE_IDS.OWNER) return fail('Only the Owner can delete a purchase.');
```

This is deliberate — voiding a financial record should not depend on how the permissions table is configured.

---

## 5. Core Data Flows

### 5.1 Purchase → Stock In

```
createPurchase()
  │
  ├── Purchases row (header: supplier, totals, payment status)
  │
  ├── For each line item:
  │     ├── Batches row (new batch with expiry date, purchase price)
  │     ├── recalculateInventory()
  │     │     ├── Inventory row updated (CurrentStock = SUM of batch quantities)
  │     │     └── StockMovements row (Type=Purchase, PreviousStock→NewStock)
  │     └── PurchaseItems row (links Purchase → Batch → Product)
  │
  └── adjustSupplierBalance(supplierId, unpaidAmount)
```

### 5.2 Sale → Stock Out (FEFO)

```
createSale()
  │
  ├── Validate all cart items (product exists, enough available stock)
  │     Normal products: check CurrentStock
  │     Sell-by-pill products: check CurrentStock × PillsPerUnit + LoosePills
  │
  ├── Sales row (header: cashier, totals, payment method)
  │
  ├── For each cart item:
  │     ├── Read product.SellByPill flag
  │     │
  │     ├── If SellByPill = true:
  │     │     └── deductPillsFEFO(productId, qty)
  │     │           ├── Check loose pills first (Inventory.LoosePills)
  │     │           ├── If enough: decrement LoosePills, log StockMovement
  │     │           └── If not enough: break new strips via deductStockFEFO
  │     │                 → deduct whole units from soonest-expiring batch
  │     │                 → store remaining loose pills with batch traceability
  │     │
  │     └── If SellByPill = false:
  │           └── deductStockFEFO(productId, qty)
  │                 ├── Get batches WHERE Quantity > 0, SORT BY ExpiryDate ASC
  │                 ├── For each batch (soonest expiry first):
  │                 │     ├── batch.Quantity -= take
  │                 │     └── consumed[] ← {batchId, qty, unitCost}
  │                 ├── recalculateInventory()
  │                 │     ├── Inventory row updated
  │                 │     └── StockMovements row (Type=Sale)
  │                 └── For each consumed batch:
  │                       └── SaleItems row (links Sale → Batch → Product)
  │                             with UnitPrice, MarginUsed
  │
  └── bumpOpenDrawer(cashierId, paymentField, grandTotal)
```

### 5.3 Return → Restock or Discard

```
createReturn()
  │
  ├── Verify original sale exists and product was part of it
  │
  ├── If resalable (not Damaged/Expired):
  │     └── receiveBatch() → creates new sellable batch + stock movement
  │
  ├── If not resalable:
  │     └── StockMovements row with 0 quantity (audit trail only)
  │
  ├── Returns row (refund amount, reason, approved by)
  │
  └── bumpOpenDrawer(cashierId, field, -refundAmount)
```

### 5.4 Cash Drawer Shift Lifecycle

```
Start: startShift(openingBalance)
  → CashDrawer row: OpeningBalance set, all sales counters = 0

During shift: sales/returns automatically call bumpOpenDrawer()
  → CashSales / CardSales / MobileMoney incremented/decremented

End: endShift(countedCash)
  → expected = OpeningBalance + CashSales - Expenses
  → difference = countedCash - expected
  → ShiftSales rows created (itemized product-level snapshot)
  → CashDrawer row closed with ClosingBalance, Difference, ClosedAt
```

### 5.5 Margin Pricing Flow

**Standard product:**
```
Product Setup:
  Product.DefaultMargin = 25 (%)
  Product.PurchasePrice = $8.00
  Product.SellingPrice = $10.00 (catalog price, fallback)
  Product.SellByPill = false

Add to Cart (POS):
  → read Product.DefaultMargin (25%)
  → calcPrice = PurchasePrice × (1 + margin/100) = $8.00 × 1.25 = $10.00
  → cart item = { price: $10.00, marginUsed: 25, purchasePrice: $8.00, catalogPrice: $10.00 }

Cashier changes margin dropdown to 30%:
  → changeCartMargin(productId, 30)
  → item.marginUsed = 30
  → item.price = $8.00 × 1.30 = $10.40
  → renderCart() recalculates totals

Checkout:
  → sends [{ productId, qty: 1, unitPrice: $10.40, marginUsed: 30 }]
  → backend uses unitPrice (not catalog SellingPrice) for line totals
  → SaleItems row records { UnitPrice: $10.40, MarginUsed: 30 }
```

**Sell-by-pill product:**
```
Product Setup:
  Product.DefaultMargin = 25 (%)
  Product.PurchasePrice = $8.00 (per unit)
  Product.SellingPrice = $10.00 (per unit)
  Product.PillsPerUnit = 10
  Product.SellByPill = true

Add to Cart (POS):
  → calcPrice = PurchasePrice × (1 + margin/100) = $8.00 × 1.25 = $10.00
  → per-pill price = $10.00 / 10 = $1.00
  → cart item = { price: $1.00, marginUsed: 25, purchasePrice: $0.80, catalogPrice: $1.00 }
  → qty starts at 1 (one pill)

Cart UI shows: Units [0] Pills [1] = 1 pill, $1.00 per pill · $10.00 per unit

Cashier changes margin to 30%:
  → item.price = $0.80 × 1.30 = $1.04 per pill
  → priceLabel updates: "$1.04 per pill · $10.40 per unit"
```

### 5.6 Pill Selling Flow

```
Product Setup:
  Product.PillsPerUnit = 10 (strip of 10 pills)
  Product.PurchasePrice = $8.00 (per unit)
  Product.SellingPrice = $10.00 (per unit, catalog price)
  Product.DefaultMargin = 25%
  Product.SellByPill = true
  Inventory.CurrentStock = 5 (five whole strips)
  Inventory.LoosePills = 3 (three loose pills from a previous break)

POS displays: "53 pills" (5 × 10 + 3)

Customer taps product tile → addToCart():
  → per-pill price = PurchasePrice × (1 + margin/100) / PillsPerUnit
                   = $8.00 × 1.25 / 10 = $1.00 per pill
  → cart item = { price: $1.00, qty: 1, pillsPerUnit: 10 }

Cart renders Units + Pills inputs:
  Units [0]  Pills [1]  = 1 pill

Customer changes to Units [2] → updateSellByPillQty():
  → total = 2 × 10 + 1 = 21 pills
  → cart item.qty = 21

Customer adjusts Pills to 3:
  → total = 2 × 10 + 3 = 23 pills
  → cart item.qty = 23

Checkout:
  → sends { productId, qty: 23, unitPrice: $1.00, marginUsed: 25 }
  → backend calls deductPillsFEFO(productId, 23)
    → loosePills (3) < pillsWanted (23), need 20 more
    → unitsToBreak = ceil(20/10) = 2 strips
    → deductStockFEFO(productId, 2) → deducts from soonest-expiring batch
    → pillsFromNewBreaks = 2 × 10 = 20
    → newLoosePills = 3 + 20 - 23 = 0
    → Inventory updated: CurrentStock = 3, LoosePills = 0
```

---

## 6. Caching Strategy

| Cache key | TTL | What it stores | Invalidated by |
|---|---|---|---|
| `rolePermissionsMap` | 30 min | RoleID → [PermissionID] map | Auto-expiry or `clearPermissionCache()` |
| `settingsMap` | 30 min | Setting → Value map | `updateSettings()` clears it |
| `schema-ok:<sheetName>` | 6 hours | "This sheet's headers are up to date" | `clearSchemaCache()` |

Dashboard metrics are computed **live** on each load (no caching). This is fine for small/medium data volumes. The `DashboardCache` table exists in the schema for future write-on-change rollups.

---

## 7. Frontend Architecture (Index.html)

### 7.1 Structure

The entire frontend is a single HTML file with:

- **Inline CSS** (~185 lines of custom properties, layout, responsive breakpoints, print styles)
- **Inline JS** (~1240 lines of vanilla JavaScript)
- **No build step, no framework, no external dependencies**

### 7.2 Views (SPA routing)

The app uses a sidebar-based SPA pattern. Clicking a nav button hides all views and shows the target:

| View | ID | Content |
|---|---|---|
| Dashboard | `view-dashboard` | Summary cards, 4 charts (sales trend, top products, profit trend, category breakdown), low-stock table, expiry table |
| Sales (POS) | `view-pos` | Product grid (grouped by category) with pill-aware stock display, cart panel with margin dropdowns and Units+Pills inputs for sell-by-pill products, checkout controls |
| Sales History | `view-salesHistory` | Transaction table with drill-down modal |
| Products | `view-inventory` | Product catalog table with search, add/edit/delete, margin and pill configuration |
| Purchases | `view-purchases` | Purchase order table with create/view/delete, detail modal with supplier info and payment history |
| Suppliers | `view-suppliers` | Supplier table with add/edit |
| Customers | `view-customers` | Customer table with add/edit |
| Finance | `view-finance` | Tabbed: Expenses / Income / Supplier Payments |
| Cash Drawer | `view-cashdrawer` | Start/end shift, shift history |
| Users | `view-users` | User table with add, enable/disable, password reset |
| Settings | `view-settings` | Business info form + system settings form (including margin presets) |

### 7.3 RPC Layer

All backend calls go through a thin wrapper:

```js
function call(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  return new Promise(function(resolve, reject) {
    google.script.run
      .withSuccessHandler(function(res) {
        if (res === null) resolve({ success: false, message: 'No response...' });
        else resolve(res);
      })
      .withFailureHandler(function(err) { reject(err.message); })
      [fn].apply(null, args);
  });
}
```

Every backend function returns `{ success: true, ...data }` or `{ success: false, message: '...' }`.

### 7.4 POS-Specific Frontend Logic

**Global state:**
```js
var marginPresets = [20, 25, 30];  // loaded from Settings.MarginPresets on login
var cart = [];  // array of { productId, name, price, catalogPrice, taxRate, qty, stock,
                //   marginUsed, purchasePrice, pillsPerUnit, sellByPill }
```

For sell-by-pill products, `price`, `catalogPrice`, and `purchasePrice` are all **per-pill** (divided by `PillsPerUnit` at add-to-cart time). `qty` is always the total number of pills.

**Key functions:**
| Function | Purpose |
|---|---|
| `posTileHtml(product)` | Renders product tile with pill-aware stock label ("53 pills" vs "5 in stock") |
| `addToCart(productId)` | Detects SellByPill flag. For pill products, divides unit prices by PillsPerUnit to get per-pill price. Adds 1 pill per tap. |
| `changeCartQty(productId, delta)` | Updates quantity for standard products (step = 1 unit) |
| `updateSellByPillQty(productId)` | Reads Units + Pills inputs, computes total = (units × ppu) + pills. Auto-carries if pills ≥ ppu. Validates stock. |
| `changeCartMargin(productId, newMargin)` | Recalculates line price from new margin using per-pill purchasePrice |
| `renderCart()` | Renders cart: standard items get `[-] [+]` counter; sell-by-pill items get **Units** and **Pills** number inputs with live `oninput` updates |
| `ppuFor(item)` | Returns pillsPerUnit (defaults to 1). Helper for sell-by-pill math. |
| `loadMarginPresets()` | Loads margin presets from Settings on login |

**Sell-by-pill cart UI:**
```
┌─────────────────────────────────────────┐
│ Amoxicillin 500mg                       │
│ $0.80 per pill · $8.00 per unit         │
│                                         │
│ Units [2]  Pills [3]  = 23 pills        │
│                                         │
│ [▼ 25%] 25% margin                     │
└─────────────────────────────────────────┘
```

The `updateSellByPillQty` function fires on every `oninput` event. If the user types `pills ≥ ppu`, it auto-carries: `units += floor(pills/ppu); pills = pills % ppu`. If total ≤ 0, the item is removed from cart.

### 7.5 UI Features

- **Responsive:** Mobile sidebar with hamburger menu at ≤860px
- **Charts:** Dependency-free vertical and horizontal bar charts built from plain divs
- **Receipt printing:** `@media print` CSS that shows only the receipt area
- **Double-click prevention:** `runGuarded(btn, fn)` disables buttons during async operations
- **Permission-gated UI:** Sidebar nav items and action buttons are hidden based on the user's permissions

---

## 8. Security Considerations

| Area | Implementation |
|---|---|
| Password storage | SHA-256 hash via `Utilities.computeDigest`. Acceptable for v1; upgrade to bcrypt or Google SSO for production. |
| Authorization | Every backend function calls `authorize(userId, permissionId)` which re-derives the user from the sheet. Client-sent role/permissions are ignored. |
| Soft deletes | Products and purchases are never hard-deleted — history is preserved. |
| Audit trail | Every significant action is logged with timestamp, user ID, action type, and details. |
| LockService | Prevents concurrent overselling or double-ending of shifts. |
| Input validation | Backend validates all inputs and returns descriptive error messages. |
| Error wrapping | The `safe()` function wraps every module function in try/catch, converting exceptions to `{ success: false, message }` responses. |

---

## 9. Setup & Deployment

### Prerequisites
- A Google account
- Google Sheets access

### Steps

1. Upload `Pharmacy_Database_v1.xlsx` to Google Drive → open as Google Sheet
2. Copy the spreadsheet ID from the URL
3. Extensions → Apps Script → create each `.gs` file and `Index.html`
4. Paste spreadsheet ID into `SPREADSHEET_ID` in `constants.gs`
5. Run `initializeSystem` once (verifies sheets, seeds admin if Users is empty)
6. Deploy → New deployment → Web app → Execute as "Me" → Access "Anyone with the link"
7. Open the deployed URL and log in with `admin` / `ChangeMe123`

### Default seeded data
- 1 Owner user (admin / ChangeMe123)
- 3 sample products (Paracetamol, Amoxicillin, Vitamin C) with opening stock batches
- 5 categories (from the Excel template)
- 3 roles with 21 permissions and the role→permission matrix

---

## 10. Known Issues & Technical Debt

### 10.1 Dashboard computes live (no rollup cache)

Dashboard metrics are computed by scanning all sales/products/inventory on every page load. The `DashboardCache` table exists in the schema but is not yet used. For pharmacies with thousands of transactions, consider writing rollups into `DashboardCache` after each sale/purchase.

### 10.2 Prescriptions not wired

`Prescriptions` and `PrescriptionItems` tables exist in the schema and have column headers, but no backend functions or UI views reference them.

### 10.3 Notifications not persisted

`Notifications` table exists but the system computes alerts live on the dashboard rather than writing to the notifications table. A persisted, dismissible inbox UI is deferred.

### 10.4 Adjust Stock permission reserved

`PERM_ADJUST_STOCK` is defined in `constants.gs` but no stock adjustment UI or backend function currently uses it. This is reserved for a future manual stock count / correction feature.

---

## 11. File Inventory

| File | Lines | Role |
|---|---|---|
| `constants.gs` | 140 | Configuration & schema |
| `database.gs` | 129 | Database abstraction layer |
| `auth.gs` | 75 | Authentication & authorization |
| `utilities.gs` | 65 | Shared helpers (safe(), ok(), fail(), logAudit, etc.) |
| `setup.gs` | 60 | One-time initialization |
| `products.gs` | 248 | Product catalog, batches, inventory, FEFO, pill deduction |
| `sales.gs` | 120 | Point of sale with dynamic pricing |
| `purchases.gs` | 176 | Purchase orders with supplier detail view |
| `returns.gs` | 63 | Sale returns |
| `finance.gs` | 240 | Expenses, income, payments, cash drawer |
| `masters.gs` | 122 | Categories, suppliers, customers |
| `users.gs` | 62 | User management |
| `settings.gs` | 46 | Settings & business info |
| `dashboard.gs` | 229 | Analytics & charts |
| `code.gs` | 24 | Web app entry point |
| `Index.html` | ~1940 | Single-page frontend (POS with Units+Pills pill inputs, margin dropdowns) |
| `inventory.gs` | 10 | **Deprecated** — empty placeholder, superseded by `products.gs` |
| **Total** | **~3,824** | |
