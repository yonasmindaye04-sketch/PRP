# Pharmacy ERP — System Design

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (SPA)                        │
│  Index.html — ~4,050 lines of vanilla HTML/CSS/JS       │
│  No framework, no build step, no external dependencies  │
│                                                         │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ Login      │  │ App Shell  │  │ Modals           │  │
│  │ Screen     │  │ + Sidebar  │  │ (CRUD forms,     │  │
│  │            │  │ + 14 Views │  │  detail views)   │  │
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
│  │ + adjust + │  │ + searchable │  │ + store      │   │
│  │ ledger     │  │ history      │  │ scope        │   │
│  └────────────┘  └──────────────┘  └──────────────┘   │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ stores.gs  │  │ returns.gs   │  │ finance.gs   │   │
│  │ Branches,  │  │ Restock or   │  │ Expenses,    │   │
│  │ per-store  │  │ discard +    │  │ Income,      │   │
│  │ stock,     │  │ refund       │  │ Payments,    │   │
│  │ transfers  │  │              │  │ Cash Drawer  │   │
│  └────────────┘  └──────────────┘  └──────────────┘   │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ masters.gs │  │ users.gs     │  │dashboard.gs  │   │
│  │ Categories,│  │ CRUD +       │  │ Metrics,     │   │
│  │ Suppliers, │  │ enable/      │  │ charts,      │   │
│  │ Customers  │  │ disable      │  │ alerts,      │   │
│  │            │  │              │  │ profit       │   │
│  └────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              GOOGLE SHEETS (31 tables)                  │
│  Each sheet = one database table                        │
│  Frozen header row = column schema                      │
│  IDs are foreign keys throughout                        │
│                                                         │
│  Config: Settings, BusinessInfo                         │
│  Auth:   Users, Roles, Permissions, RolePermissions     │
│  Stores: Stores, StoreTransfers                          │
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
- **`PERMISSIONS`** — 24 permission constants (`PERM_VIEW_DASHBOARD`, `PERM_SELL`, `PERM_MANAGE_STORES`, etc.)
- **`DEFAULT_STORE_ID`** — `STORE000001`, the implicit home branch for a single-store deployment
- **`STOCK_HEALTH`** — the four health tiers: `out_of_stock`, `critical`, `low`, `ok`
- **`STOCK_MOVEMENT_TYPES`** — every ledger type the system can post (`OpeningStock`, `Purchase`, `Sale`, `Return`, `Adjustment`, `DamageLoss`, `TransferOut`, `TransferIn`, `SaleVoided`, `PurchaseDeleted`, `ExpiredWriteOff`)
- **`MANUAL_ADJUSTMENT_TYPES`** — which movement types a user may post by hand, the direction each allows, and whether it may go negative
- **`CACHE_TTL_SECONDS`** — 1800 (30 minutes), used for permissions and settings cache
- **`ERROR_CODES`** — Enum of 11 structured error codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INSUFFICIENT_STOCK`, `INVALID_STATE`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SHEET_ERROR`, `LOCK_TIMEOUT`. Used by `fail(message, code)` for structured client handling.

Notable schema fields added for new features:
- **Products**: `DefaultMargin`, `PillsPerUnit`, `SellByPill`, `StoreID` (home store)
- **Inventory**: `LoosePills`, `LoosePillsBatchID`, `StoreID` (inventory key is ProductID + StoreID)
- **Batches / StockMovements / Sales / Purchases**: `StoreID`
- **SaleItems**: `MarginUsed`
- **Stores**: `StoreID`, `StoreName`, `Code`, `StoreType`, `Address`, `Phone`, `Email`, `Manager`, `OpeningDate`, `IsDefault`, `Active`
- **StoreTransfers**: `TransferID`, `FromStoreID`, `ToStoreID`, `ProductID`, `Quantity`, `UnitCost`, `TotalValue`, `Reason`, `Status`
- **Settings**: `MarginPresets` (CSV, e.g., "20,25,35")

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
| `updateRowByIndex(name, rowIndex, updates)` | Writes to a known sheet row. Needed for `Inventory`, whose key is `(ProductID, StoreID)` and therefore not addressable by a single ID field. |
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
| `logAudit(userId, action, details, userAgent, ip)` | Writes to AuditLogs sheet with UUID, timestamp, user, action, details, **device/user-agent**, and **IP**. |
| `ok(data)` | Returns `{ success: true, ...data }`. |
| `fail(message, code)` | Returns `{ success: false, message: '...', code?: ERROR_CODES }`. Optional error code for structured client handling. |
| `safe(fn)` | Wraps a function body in try/catch. Returns a callable that catches exceptions and returns `fail()` instead of throwing. Used by every module function. |
| `classifyStock(qty, threshold)` | Returns the four-tier health label (`ok` / `low` / `critical` / `out_of_stock`) for a quantity against a threshold. |
| `parseDateStart(value)` / `parseDateEnd(value)` | Turn a `YYYY-MM-DD` filter field into a local-day boundary Date, so date-range filters cover whole days. |
| `todayIsoDate()` | Today as `YYYY-MM-DD` (used by the store bootstrap and date pickers). |
| `reportClientError(payload)` | Receives client-side JS errors (message, stack, context, userAgent, URL) and logs them to AuditLogs with action `CLIENT_ERROR`. |
| `archiveAuditLogs(retentionDays)` | Moves AuditLogs rows older than `retentionDays` (default 90) into yearly archive sheets (`AuditLogs_Archive_YYYY`). |
| `setupArchiveTrigger()` | Creates a daily 2 AM trigger for `archiveAuditLogs`. Run once manually. |

**Error codes** (defined in `constants.gs`):
`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INSUFFICIENT_STOCK`, `INVALID_STATE`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SHEET_ERROR`, `LOCK_TIMEOUT`

### 2.5 `products.gs` — Product Catalog, Batches & Inventory

The most complex module. Three tables work together:

- **Products** — the catalog row (name, pricing, reorder levels, supplier, default margin, pill config, home store)
- **Batches** — individual deliveries with their own expiry date, purchase price and owning store
- **Inventory** — a derived rollup: `CurrentStock = SUM(Batches.Quantity WHERE ProductID = X AND StoreID = Y)`, plus `LoosePills` and `LoosePillsBatchID` for pill-selling products

**Store scoping:** every stock function takes a `storeId` argument and resolves it through `resolveStoreId()` — a blank or missing id falls back to `DEFAULT_STORE_ID`, so a single-store deployment keeps working unchanged. Inventory lookups go through `findInventoryRow(productId, storeId)` because `ProductID` alone is no longer unique.

**Key invariant:** `Inventory.CurrentStock` is **never edited directly**. Every stock change goes through:

1. A batch quantity change (via `receiveBatch` or `deductStockFEFO` or `deductPillsFEFO`)
2. `recalculateInventory()` recomputes from batches and writes the new total
3. A `StockMovements` row is appended describing the change

**FEFO deduction (`deductStockFEFO`):**
```
get batches for product AND store WHERE Quantity > 0
sort by ExpiryDate ascending (soonest first)
for each batch:
  take = min(batch.Quantity, remaining)
  decrement batch.Quantity
  record {batchId, qty, unitCost} as consumed
  remaining -= take
if remaining > 0: throw "Not enough stock"
recalculateInventory(productId, storeId, ...)
return consumed[]
```

**Pill FEFO deduction (`deductPillsFEFO`):**
```
get product.PillsPerUnit, Inventory.LoosePills, Inventory.CurrentStock (for this store)

Case 1: loose pills ≥ pills wanted
  → decrement LoosePills, log StockMovement, return

Case 2: need to break new strips
  → pillsStillNeeded = pillsWanted - loosePills
  → unitsToBreak = ceil(pillsStillNeeded / pillsPerUnit)
  → deductStockFEFO(productId, storeId, unitsToBreak, ...)  ← breaks whole units via FEFO
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
  StoreID, StoreName, Threshold, StockHealth,
  DisplayStock  // pills if SellByPill, units otherwise
}
```

**Stock adjustments (`recordStockAdjustment`):**
The single audited entry point for "the stock changed but nobody sold anything". Input is `{ productId, storeId, movementType, direction, quantity, reason, notes, purchasePrice, sellingPrice, expiryDate }`.

```
1. authorize(userId, PERM_ADJUST_STOCK)
2. validate: known product, known movement type, quantity > 0, reason ≥ 3 chars, known store
3. direction is constrained by the type:
   'in'  → OpeningStock, Return
   'out' → DamageLoss, ExpiredWriteOff
   'both'→ Adjustment (the user picks in/out)
4. IN  → create a Batches row (cost + expiry preserved) → recalculateInventory(+qty)
   OUT → take from existing batches FEFO within the store → recalculateInventory(-qty)
         (types flagged allowNegative may post a loss even when nothing is on hand)
5. append StockMovements row (ReferenceType = 'ManualAdjustment') + AuditLogs row
6. return { movementId, productName, storeId, newQuantity }
```

**Movement ledger (`getStockMovements`):** the append-only history, filterable by product, movement type, store and date range, searchable by product name / type / remarks / reference / batch / user, sorted newest-first and paginated (page size ≤ 200). `getProductStockHistory()` returns the same slice for one product.

**Inventory summary (`getInventorySummary`):** the KPI card data — total units, stock value at cost, retail value, the four health-tier counts and 30-day movement activity (movements, units in, units out, units sold, units received). Passing a `storeId` scopes it to one branch; omitting it aggregates every branch.

### 2.6 `sales.gs` — Point of Sale

```
createSale(userId, cart[{productId, qty, unitPrice, marginUsed}], options)
  1. validate all cart items (product exists, enough stock at the active store)
     - for sell-by-pill products: checks stock in pills (CurrentStock × PillsPerUnit + LoosePills)
     - for normal products: checks CurrentStock
  2. compute line totals using the dynamic unitPrice from cart (not the catalog price)
  3. compute grandTotal = subtotal - discount + tax
  4. insert Sales row (SALE000001, timestamp, cashier, totals, payment method, StoreID)
  5. for each cart item:
       if product.SellByPill:
         deductPillsFEFO(productId, storeId, qty, 'Sale', 'Sale', saleId, ...)
       else:
         deductStockFEFO(productId, storeId, qty, 'Sale', 'Sale', saleId, ...)
       for each consumed batch:
         insert SaleItems row with BatchID, UnitPrice, MarginUsed
  6. bumpOpenDrawer(cashierId, field, grandTotal)  ← updates running shift totals
  7. return { saleId, total, change }
```

**Dynamic pricing:** The cart sends `unitPrice` and `marginUsed` per item. The backend uses these instead of the catalog `SellingPrice`, enabling per-line margin selection at the POS.

**Concurrency:** `LockService.getScriptLock()` prevents two concurrent sales from overselling the same batch.

**SaleItems ↔ BatchID linkage:** Each SaleItem records which batch supplied its units, the unit price charged, and the margin used. This enables profitability analysis and batch traceability.

**Sales history (`getSales(userId, filters, page, pageSize)`):** the complete transaction log — never truncated to "recent only". Filters: date range, payment method, status, cashier, store, minimum and maximum total, plus free-text search across sale id, invoice number, customer id/name/phone, cashier name and the names of the products sold. Results are sorted by date or total (asc/desc) and paginated server-side, and the response carries a `summary` block (count + total amount for the current filter). `getSalesCashiers()` populates the cashier dropdown.

### 2.7 `purchases.gs` — Purchase Orders

```
createPurchase(userId, {supplierId, items[], discount, tax, paidAmount})
  1. validate supplier and all line items
  2. for each line item, determine final selling price:
       IF sellingPrice typed manually → use it
       ELSE IF new purchasePrice > catalog PurchasePrice:
           sellingPrice = newCost × (1 + product.DefaultMargin / 100)  ← AUTO-CALCULATED
       ELSE → keep existing catalog SellingPrice
  3. insert Purchases row (PUR000001, timestamp, totals, PaymentStatus)
  4. for each line item:
       receiveBatch(productId, qty, purchasePrice, sellingPrice, expiryDate, ...)
         → creates a Batches row with the delivery's expiry/cost
         → recalculates Inventory
         → appends StockMovements
       insert PurchaseItems row with BatchID
       IF new purchasePrice > catalog PurchasePrice:
           updateRowById(PRODUCTS, ProductID, { PurchasePrice, SellingPrice, UpdatedDate })
           ← permanently updates the catalog price
  5. adjustSupplierBalance(supplierId, grandTotal - paidAmount)  ← increases what we owe
```

**Auto price update on restock:** If the supplier charges more than the previously recorded cost, the product catalog is updated automatically. The new `SellingPrice` is recalculated using the product's `DefaultMargin` so profit margins are preserved without manual intervention.

**`getPurchaseDetails`** returns enriched data:
- Purchase header + all line items with product names
- Supplier contact details (phone, email, address, tax number, payment terms)
- Payment history with recorded-by user names
- Financial summary (totals, balance due)

**Soft delete (Owner-only):** `deletePurchase` reverses stock (reduces batch quantities, recalculates inventory), reverses the supplier balance for the unpaid portion, and marks `RecordStatus = 'Deleted'` with a required reason.

### 2.8 `returns.gs` — Sale Returns

```
createReturn(userId, saleId, productId, qty, reason)
  1. verify the original sale and sale item exist
  2. validate return quantity ≤ original quantity
  3. resolve the store: returns always go back to the store the original
     sale was made from (sale.StoreID)
  4. if resalable (not Damaged/Expired):
       receiveBatch(productId, returnQty, ..., storeId)  ← creates a new sellable batch
     else:
       append StockMovements with 0 quantity (logged but no stock added)
  5. insert Returns row (RET000001, amount, approvedBy)
  6. bumpOpenDrawer(cashierId, field, -refundAmount)  ← subtracts from shift totals
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
| `getDashboardSummary` | Today's sales total, transaction count, expenses, product count, low-stock count (smart fallback threshold), expiry-soon count, today's profit (Owner/Pharmacist only) |
| `getSalesTrend(days)` | Daily sales totals for the last N days (powers the bar chart) |
| `getTopProducts(days, limit)` | Top-selling products by revenue over the last N days |
| `getCategoryBreakdown(days)` | Revenue grouped by category over the last N days |
| `getPeriodComparison` | Month-over-month and year-over-year revenue comparison with percentage change |
| `getProfitTrend(days)` | Daily profit (revenue − COGS − expenses) for the last N days |

**Smart low-stock threshold:** Each product is compared against its own `ReorderLevel` if that value exists and is greater than 0. If the product's `ReorderLevel` is 0 or blank, the global `LowStockAlertThreshold` from Settings is used as the fallback. This prevents products with an unset `ReorderLevel` from always appearing in the low-stock list.

```javascript
var threshold = (p.ReorderLevel && Number(p.ReorderLevel) > 0)
    ? Number(p.ReorderLevel)
    : defaultLowStock;  // from Settings
return (stockByProduct[p.ProductID] || 0) <= threshold;
```

Profit computation: for each sale item, the cost is `SaleItem.Quantity × Batch.PurchasePrice` (the batch's actual cost at the time of purchase, not the product's current catalog price).

**Multi-store aggregation:** the dashboard adds up stock and sales across every branch, so the owner sees the whole business on one screen. Per-branch numbers are available from `stores.gs` (`getStoreSummary`, `getStoreSalesReport`).

### 2.11 `stores.gs` — Stores, Transfers & Store Reporting

The multi-branch module. A store is a physical location that holds its own stock.

| Function | Permission | What it does |
|---|---|---|
| `getStores(userId)` | any signed-in user | Every store with live stats: unit count, stock value at cost, product count, out-of-stock and low-stock counts. Always includes the default store, even before it is seeded. |
| `createStore(userId, input)` | `PERM_MANAGE_STORES` | Creates a branch: name, code, type (Retail / Warehouse / Depot / Clinic), address, phone, email, manager, opening date, notes. Duplicate names are rejected. |
| `updateStore(userId, input)` | `PERM_MANAGE_STORES` | Edits those fields. |
| `deactivateStore(userId, storeId)` | `PERM_MANAGE_STORES` | Soft-disables a branch. The default store can never be disabled, and a branch that still holds stock is refused — transfer it out first. |
| `getStoreInventory(userId, storeId)` | any signed-in user | The stock position of every product in one branch, with threshold, four-tier health and stock value. |
| `getStoreSummary(userId, storeId)` | any signed-in user | KPI cards for one branch: units, cost value, retail value, health-tier counts, 30-day movement activity. |
| `transferStock(userId, input)` | `PERM_TRANSFER_STOCK` | Moves stock between branches (see 5.7). |
| `getStoreTransfers(userId, filters)` | any signed-in user | Transfer history, filterable by store, date range and free text, paginated. |
| `getStoreSalesReport(userId, from, to)` | any signed-in user | Revenue, transaction count, units sold and average basket per branch over a date range. |

**Helpers:** `resolveStoreId(storeId)` normalises a blank id to `DEFAULT_STORE_ID`; `storeExists(storeId)` validates it; `getStoreNameMap()` returns `{ StoreID → StoreName }` for enriching rows; `getDefaultStoreId()` returns the store flagged `IsDefault`.

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

Stores ──< Batches
   │     ├──< Inventory        (key: ProductID + StoreID)
   │     ├──< StockMovements
   │     ├──< Sales
   │     ├──< Purchases
   │     └──< StoreTransfers (FromStoreID + ToStoreID)

Products ──< Batches
    │            │
    │            └──> Inventory (derived, one row per product AND store)
    │                  ├── CurrentStock (sum of that store's batch quantities)
    │                  ├── LoosePills (individual pills from broken strips)
    │                  └── LoosePillsBatchID (traceability for loose pills)
    ├──> Categories
    └──> Suppliers

Customers ──< Sales
Suppliers ──< Purchases
         ──< Payments
         ──< Batches
```

### 3.1.1 The inventory key

`Inventory` has **no primary key column** because its identity is the pair `(ProductID, StoreID)`. The same product can sit in three branches at once, each with its own quantity, its own loose-pill count and its own health badge. Consequences throughout the codebase:

- `findInventoryRow(productId, storeId)` locates the row; `findInventoryRows(productId)` returns every store holding that product.
- Writes use `updateRowByIndex(SHEETS.INVENTORY, row._row, updates)` because `updateRowById` (which needs a unique ID field) cannot address an inventory row.
- `totalStockForProduct(productId)` sums across all stores for dashboard-level totals.
- `Products.StoreID` records the **home store** of a product (where it was created); it is *not* where the stock lives — that is always defined by the Batches and Inventory rows.

### 3.2 ID Generation

All IDs are sequential, human-readable, zero-padded to 6 digits:

| Table | Prefix | Example |
|---|---|---|
| Products | `MED` | MED000042 |
| Batches | `BAT` | BAT000015 |
| Users | `USR` | USR000003 |
| Roles | `ROLE` | ROLE_OWNER |
| Categories | `CAT` | CAT000001 |
| Stores | `STORE` | STORE000002 |
| Store Transfers | `TRF` | TRF000007 |
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
- `recordStockAdjustment` (15s timeout)
- `transferStock` (15s timeout)
- `createReturn` (10s timeout)

---

## 4. Permission Model

### 4.1 Roles

| Role | ID | Typical access |
|---|---|---|
| Owner | `ROLE_OWNER` | Everything — full admin |
| Pharmacist | `ROLE_PHARMACIST` | View dashboard + profit, manage products/purchases/suppliers, sell, refund |
| Cashier | `ROLE_CASHIER` | View products, sell, view own sales, manage cash drawer |

### 4.2 Permissions (24 total)

| Permission | ID | Used in |
|---|---|---|
| View Dashboard | `PERM_VIEW_DASHBOARD` | `dashboard.gs` |
| View Products | `PERM_VIEW_PRODUCTS` | `products.gs`, `sales.gs` |
| Create Product | `PERM_CREATE_PRODUCT` | `products.gs` |
| Edit Product | `PERM_EDIT_PRODUCT` | `products.gs` |
| Delete Product | `PERM_DELETE_PRODUCT` | `products.gs` |
| Adjust Stock | `PERM_ADJUST_STOCK` | `products.gs` (`recordStockAdjustment`) |
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
| View Audit Logs | `PERM_VIEW_AUDIT_LOGS` | `utilities.gs` (`getAuditLogs`) + Audit Logs view |
| Manage Settings | `PERM_MANAGE_SETTINGS` | `settings.gs` |
| Manage Stores | `PERM_MANAGE_STORES` | `stores.gs` (create / edit / deactivate branches) |
| View Stock Movements | `PERM_VIEW_STOCK_MOVEMENTS` | `products.gs` (`getStockMovements`) + Stock Ledger view |
| Transfer Stock | `PERM_TRANSFER_STOCK` | `stores.gs` (`transferStock`) |

**Owner shortcut:** `hasPermission()` returns `true` for the Owner, and `getPermissionsForRole()` now hands the Owner the *complete* list of permission ids from the Permissions sheet. Without that second half the frontend would hide screens (Stores, Stock Ledger, Audit Logs) from the one role that is allowed to use them.

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

### 5.7 Manual Stock Adjustment (opening balance, recount, damage)

```
Adjust Stock modal (Adjust Stock button on a product row, or the
"Adjust Stock" action in the Products view)
  │
  ├── User picks: product, store, movement type, direction, quantity,
  │               reason (mandatory), optional notes / cost / expiry
  ├── Frontend shows a LIVE projection:
  │     current stock → projected stock, and a warning when the removal
  │     would go negative
  │
  └── recordStockAdjustment(userId, input)
        │
        ├── authorize(userId, PERM_ADJUST_STOCK)
        ├── validate product / type / quantity / reason / store
        ├── direction is constrained by the movement type
        │
        ├── direction = IN
        │     ├── create a Batches row (quantity, cost, expiry) at the store
        │     ├── recalculateInventory(+qty) → StockMovements row
        │     └── OpeningStock also refreshes Products.PurchasePrice
        │
        └── direction = OUT
              ├── take the units from existing batches, FEFO within the store
              ├── recalculateInventory(-qty) → StockMovements row
              └── a loss may still be posted when nothing is on hand
                    (the remarks record what was actually on hand)
        │
        └── AuditLogs row: who, which product, which store, qty, reason
```

### 5.8 Inter-store Transfer

```
Transfer modal (Stores view → Transfer Stock)
  │
  ├── User picks: product, source store, destination store, quantity,
  │               reason (mandatory), optional reference and notes
  │
  └── transferStock(userId, input)
        │
        ├── authorize(userId, PERM_TRANSFER_STOCK)
        ├── validate: different stores, both exist, qty > 0, reason present
        ├── verify the source store actually holds enough stock
        │
        ├── take the units from the source batches (FEFO within that store)
        ├── for each consumed batch:
        │     ├── StockMovements row: TransferOut  (−qty, source store)
        │     └── receiveBatch(...) at the destination → new batch with the
        │           SAME expiry date
        │             └── StockMovements row: TransferIn (+qty, destination store)
        │
        ├── StoreTransfers row (TRF000007): from, to, product, qty, value, reason
        └── AuditLogs row
```

Both halves of the transfer share the same `TransferID`, so the ledger can always be read as a pair, and the destination keeps a correct expiry date so FEFO still works there.

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
| Sales History | `view-salesHistory` | Full transaction log with search + filter bar (date range, payment, status, cashier, store, min/max total), result summary, removable filter chips, server-side pager and a drill-down modal |
| Products | `view-inventory` | Product catalog table with search, category, stock-health and branch-scope filters, four-tier health badges, KPI cards, add/edit/delete (incl. opening balance), margin and pill configuration |
| Stock Ledger | `view-stockLedger` | Append-only movement history with type / store / date filters, free-text search and a pager |
| Stores | `view-stores` | Branch cards with stock value, health and revenue KPIs, add/edit/deactivate, per-branch stock table and transfer history |
| Purchases | `view-purchases` | Purchase order table with create/view/delete, receiving-store field, detail modal with supplier info and payment history |
| Suppliers | `view-suppliers` | Supplier table with add/edit |
| Customers | `view-customers` | Customer table with add/edit |
| Finance | `view-finance` | Tabled: Expenses / Income / Supplier Payments |
| Cash Drawer | `view-cashdrawer` | Start/end shift, shift history |
| Users | `view-users` | User table with add, enable/disable, password reset |
| Audit Logs | `view-auditLogs` | Append-only audit trail (who changed what, when) |
| Settings | `view-settings` | Business info form + system settings form (including margin presets) |

**Store switcher:** the top bar carries a store selector. It sets the *active* store used by the POS, the purchase receiving store, the adjust-stock target and the product list. Sales history and the stock ledger default to **All stores**, so the full history is always visible; operational screens default to the active store.

**Catalog scope filter:** the Products toolbar has its own branch selector, so the catalog and its KPI cards can be inspected for a branch other than the one being sold in (or aggregated across all branches). The POS grid always follows the active store — the two never interfere.

**Single-store mode:** while the pharmacy runs one branch, the multi-store controls (top-bar store selector, POS store chip, the store filters in Sales History / Stock Ledger / Products / Stores, "Receiving store", "Home store", "Transfer stock") are hidden with the `.ui-hidden` utility class. `loadStores()` computes `multi = activeStores.length > 1` and toggles them, so the second branch — whenever it is added — brings the whole multi-branch UI back automatically. Deactivated branches are excluded from every operational dropdown (`storeOptionsHtml()` filters on `Active`).

**Request sequencing:** Apps Script round-trips can complete out of order. Guarded loaders (`loadProducts`, `loadSalesHistory`, `loadStockLedger`) take a ticket when they start and only paint the screen if their ticket is still the newest — a slow earlier response can never overwrite a newer one.

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
- **Store switcher:** one control in the top bar scopes every operational screen to a branch
- **Stock health badges:** four-tier badges (In stock / Low / Critical / Out of stock) on product rows, KPI cards and store screens
- **Modals:** Adjust Stock, Store, Transfer, Product, Purchase, Sale detail — all built from the same markup conventions

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
- 3 roles with 24 permissions and the role→permission matrix
- 1 default store ("Main Store", `STORE000001`)

### Upgrading an existing database (multi-store + inventory)

An installation that predates the store work needs one extra step. From the Apps Script editor run:

```
upgradeToMultiStore()
```

It is **idempotent** — safe to run twice, and safe to run on a fresh database:

1. `ensureDefaultStore()` — creates the "Main Store" row (`STORE000001`) if it is missing and makes sure exactly one store is flagged `IsDefault`.
2. `seedNewPermissions()` — adds `PERM_MANAGE_STORES`, `PERM_VIEW_STOCK_MOVEMENTS` and `PERM_TRANSFER_STOCK` to the Permissions sheet and grants them to Owner (all three), Pharmacist (ledger + transfers) and Cashier (ledger only). It then clears the permission cache so the change is live immediately.
3. `migrateStoreColumns()` — backfills `StoreID` on every Products, Batches, Inventory, StockMovements, Sales and Purchases row that has none. Pre-existing rows belong to the default store.
4. `clearSchemaCache()` — forces `ensureSheet()` to re-check the headers, so the new `StoreID`, `Stores` and `StoreTransfers` columns are added if they are missing.

`initializeSystem()` performs steps 1–3 as well, so a **fresh** install only needs `initializeSystem()`.

---

## 10. Known Issues & Technical Debt

### 10.1 Dashboard computes live (no rollup cache)

Dashboard metrics are computed by scanning all sales/products/inventory on every page load. The `DashboardCache` table exists in the schema but is not yet used. For pharmacies with thousands of transactions, consider writing rollups into `DashboardCache` after each sale/purchase.

### 10.2 Prescriptions not wired

`Prescriptions` and `PrescriptionItems` tables exist in the schema and have column headers, but no backend functions or UI views reference them.

### 10.3 Notifications not persisted

`Notifications` table exists but the system computes alerts live on the dashboard rather than writing to the notifications table. A persisted, dismissible inbox UI is deferred.

### 10.4 Product `StoreID` is a home store, not the stock location

`Products.StoreID` records where the product was created. The physical stock location is always defined by the Batches and Inventory rows, so a product created in the main store can legitimately hold stock in several branches. There is no UI to *move* a product's home store — only stock can be transferred.

### 10.5 Stock ledger grows without pruning

`StockMovements` is append-only by design. At high transaction volumes (thousands of sales per day) the sheet will grow large and reads will slow down. An archive routine (`archiveAuditLogs()` exists for `AuditLogs`) can be modelled on the same pattern.

---

## 11. File Inventory

| File | Lines | Role |
|---|---|---|
| `constants.gs` | 222 | Configuration & schema (sheet names, headers, roles, 24 permissions, stock health & movement types) |
| `database.gs` | 134 | Database abstraction layer (readTable, appendRow, findRowById, updateRowById, updateRowByIndex, …) |
| `auth.gs` | 72 | Authentication & authorization |
| `utilities.gs` | 229 | Shared helpers (safe(), ok(), fail(), logAudit, classifyStock, date helpers, audit archiving) |
| `setup.gs` | 149 | One-time initialization + multi-store upgrade |
| `products.gs` | 572 | Product catalog, batches, per-store inventory, FEFO, pill deduction, stock adjustments, movement ledger, inventory summary |
| `stores.gs` | 443 | Store CRUD, per-store stock & summary, transfers, store reporting |
| `sales.gs` | 327 | Point of sale with dynamic pricing + searchable/filterable sales history |
| `purchases.gs` | 237 | Purchase orders with supplier detail view (store-aware) |
| `returns.gs` | 57 | Sale returns (restock to the source store) |
| `finance.gs` | 219 | Expenses, income, payments, cash drawer |
| `masters.gs` | 111 | Categories, suppliers, customers |
| `users.gs` | 79 | User management |
| `settings.gs` | 42 | Settings & business info |
| `dashboard.gs` | 461 | Analytics & charts (cross-store aggregation) |
| `code.gs` | 30 | Web app entry point |
| `Index.html` | ~4,050 | Single-page frontend (14 views, POS with Units+Pills inputs, store switcher, ledger, filters) |
| `inventory.gs` | 9 | **Deprecated** — empty placeholder, superseded by `products.gs` |
| **Total** | **~7,100** | |
---

## Contact & Developer Info

Developed by **Yonas Mindaye**
- Telegram: [@yona64](https://t.me/yona64)
- Phone/WhatsApp: [0910011818](https://wa.me/2510910011818)
- Email: [yonasmindaye04@gmail.com](mailto:yonasmindaye04@gmail.com)
- Website: [afro-tech-et.vercel.app](https://afro-tech-et.vercel.app/)
>
