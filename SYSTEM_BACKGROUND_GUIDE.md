# Pharmacy ERP — Technical Background Guide

> A complete explanation of how the system works behind the scenes, covering every major flow from restocking to selling, paying, and reporting.

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [How a Sale (Order) Works](#2-how-a-sale-order-works)
3. [How Purchases (Restocking) Work](#3-how-purchases-restocking-work)
4. [How Payments to Suppliers Work](#4-how-payments-to-suppliers-work)
5. [How Individual Pills Are Handled](#5-how-individual-pills-are-handled)
6. [How the Pill Product Form Works](#6-how-the-pill-product-form-works)
7. [How Inventory is Tracked (FEFO)](#7-how-inventory-is-tracked-fefo)
8. [The Cash Drawer / Shifts Work](#8-how-the-cash-drawer--shifts-work)
9. [How Returns and Refunds Work](#9-how-returns-and-refunds-work)
10. [How Profit is Calculated](#10-how-profit-is-calculated)
11. [How Low Stock Alerts Work](#11-how-low-stock-alerts-work)
12. [How Product Filters Work](#12-how-product-filters-work)
13. [How Stock Adjustments & Opening Balances Work](#13-how-stock-adjustments--opening-balances-work)
14. [How the Four-Tier Stock Health Works](#14-how-the-four-tier-stock-health-works)
15. [How Stores & Multi-Branch Stock Work](#15-how-stores--multi-branch-stock-work)
16. [How the Stock Ledger Works](#16-how-the-stock-ledger-works)
17. [How Sales History Search & Filtering Works](#17-how-sales-history-search--filtering-works)
18. [Database Tables Reference](#18-database-tables-reference)
19. [Critical Design Decisions](#19-critical-design-decisions)

---

## 1. Architecture Overview

The system is a **Google Apps Script Web App** backed by a **Google Sheets spreadsheet** acting as the database.

```
Browser (Index.html)
    │
    │   google.script.run.*(userId, ...args)
    │
    ▼
Apps Script Backend (.gs files)
    │
    │   readTable() / appendRow() / updateRowById()
    │
    ▼
Google Sheets (the database)
  ├── Stores            ← branches / outlets that hold stock
  ├── Products
  ├── Inventory         ← one row per (product, store)
  ├── Batches          ← source of truth for stock
  ├── Sales / SaleItems
  ├── Purchases / PurchaseItems
  ├── StockMovements   ← full audit log of every stock change
  ├── StoreTransfers   ← stock moved between branches
  ├── CashDrawer / ShiftSales
  ├── Returns
  ├── Expenses / Income
  ├── Payments
  └── Users / Roles
```

Every function on the backend starts with a **permission check** (`authorize(userId, PERMISSION)`) before doing anything else. If the user doesn't have the right role, the function returns an error immediately.

---

## 2. How a Sale (Order) Works

### The Full Step-by-Step Flow

#### Step 1: Cashier builds the cart (Frontend)
- The cashier taps a product tile on the POS screen.
- The product is added to the `cart` array in memory.
- For regular products: a simple `[-] qty [+]` control is shown.
- For **sell-by-pill** products: two fields appear — `Units` and `Pills` — and the total number of pills is calculated as `(Units × PillsPerUnit) + Pills`.
- The cashier can type a custom **profit margin %** into the margin input. The selling price is recalculated live as: `Price = PurchasePrice × (1 + Margin / 100)`.

#### Step 2: Checkout is triggered (Backend — `createSale()`)
When the cashier presses **Charge**, the frontend calls `createSale(userId, cart, options)`.

**Phase A — Validation (Read-only, before any writes):**
```
For every item in the cart:
  ✓ Product must exist in the database
  ✓ Quantity must be greater than zero
  ✓ For pill products: check (CurrentStock × PillsPerUnit + LoosePills) >= qty
  ✓ For regular products: check CurrentStock >= qty
  ✓ Calculate line tax: unitPrice × qty × TaxRate / 100
```
If *any* item fails validation, the entire sale is rejected. **Nothing is written yet.**

**Phase B — Recording the Sale:**
```
1. Generate a unique SaleID (e.g. SALE000042)
2. Write one row to the SALES sheet:
   SaleID, SaleDate, CustomerID, CashierID,
   TotalAmount, Discount, Tax, GrandTotal,
   PaymentMethod, AmountReceived, ChangeGiven, Status=Completed
```

**Phase C — Deducting Stock (FEFO):**
```
For every item in the cart:
  → If SellByPill=true: call deductPillsFEFO(productId, qty)
  → Otherwise:          call deductStockFEFO(productId, qty)

  Both functions return a list of { batchId, qty } — which exact
  batch(es) the stock came from.

For each batch consumed:
  → Write one row to SALE_ITEMS:
     SaleID, ProductID, BatchID, Quantity, UnitPrice, MarginUsed, Tax, Total
```

> **Why record the BatchID per sale item?**
> If a batch is recalled (bad product), you can instantly see which customers purchased from that batch.

**Phase D — Update the Cash Drawer:**
```
If PaymentMethod === 'Cash'         → increment CashSales on open shift
If PaymentMethod === 'Card'         → increment CardSales on open shift
If PaymentMethod === 'Mobile Money' → increment MobileMoney on open shift
```
If the cashier has no open shift, the sale still succeeds — the drawer tracking simply skips silently.

**Phase E — Concurrency Protection:**
The entire Phase B–D is wrapped in a **Script Lock** (`LockService`), which prevents two simultaneous sales from creating a race condition where both read the same stock level and think there is enough inventory.

---

## 3. How Purchases (Restocking) Work

### The Full Step-by-Step Flow

When you receive new goods from a supplier, you log it through the Purchases section. This calls `createPurchase(userId, input)`.

#### Step 1 — Validate All Line Items
```
For every item in the purchase order:
  ✓ Product must exist
  ✓ Quantity and price must be valid numbers

  Determine the selling price for this batch:
    IF you typed a selling price manually → use it
    ELSE IF new purchase price > old catalog price:
        → Auto-calculate: newCost × (1 + DefaultMargin / 100)
    ELSE:
        → Keep the existing catalog SellingPrice
```

#### Step 2 — Record the Purchase
```
Write one row to PURCHASES sheet:
  PurchaseID, PurchaseDate, SupplierID, InvoiceNumber,
  TotalAmount, Discount, Tax, GrandTotal,
  PaymentStatus (Paid / Partial / Unpaid),
  PaidAmount, Balance, ReceivedBy
```

#### Step 3 — Receive Stock into Batches
For every product in the purchase:
```
Call receiveBatch(productId, qty, purchasePrice, sellingPrice, expiryDate):
  1. Generate a unique BatchID (e.g. BAT000017)
  2. Write one row to BATCHES sheet:
     BatchID, ProductID, Quantity, PurchasePrice, SellingPrice, ExpiryDate, SupplierID
  3. Call recalculateInventory():
     → Sum ALL batch quantities for this product
     → Update INVENTORY row: CurrentStock = total
     → Write one row to STOCK_MOVEMENTS (type = 'Purchase')
  4. Write one row to PURCHASE_ITEMS:
     PurchaseID, ProductID, BatchID, Quantity, PurchasePrice, SellingPrice
```

#### Step 4 — Auto-Update Catalog Prices (if applicable)
```
IF new purchasePrice > product's current catalog PurchasePrice:
  → Update PRODUCTS row:
     PurchasePrice = new purchase cost
     SellingPrice  = new cost × (1 + DefaultMargin / 100)
     UpdatedDate   = now
```

#### Step 5 — Update Supplier Balance
```
Balance owed to this supplier += (GrandTotal − PaidAmount)
```

---

## 4. How Payments to Suppliers Work

Supplier payments are tracked separately from purchases. This handles scenarios like "pay a portion now, the rest later."

When you log a payment via `createPayment(userId, input)`:

```
1. Validate: supplier exists, amount > 0, amount ≤ remaining balance
2. Write one row to PAYMENTS sheet:
   PaymentID, Date, SupplierID, PurchaseID, Amount, Method, Reference
3. Reduce the Supplier's total outstanding balance by the amount paid
4. Update the linked Purchase row:
   PaidAmount += payment amount
   Balance    -= payment amount
   PaymentStatus = 'Paid' if Balance ≤ 0, else 'Partial'
```

### Payment Status Logic
| Condition | Status |
|---|---|
| PaidAmount = 0 | **Unpaid** |
| 0 < PaidAmount < GrandTotal | **Partial** |
| PaidAmount ≥ GrandTotal | **Paid** |

---

## 5. How Individual Pills Are Handled

This is the most complex feature in the system. It allows selling individual tablets from a sealed strip without manually breaking the box.

### Product Configuration (Required)
A product must have these two fields set to use pill selling:
- `SellByPill = TRUE`
- `PillsPerUnit = 10` (or however many pills are in a sealed unit)

### POS Display
```
DisplayStock = (CurrentStock × PillsPerUnit) + LoosePills
```
Example: `5 strips × 10 pills + 3 loose pills = 53 pills displayed`

The price per pill is calculated as:
```
PricePerPill = (PurchasePrice × (1 + Margin/100)) / PillsPerUnit
```

### Cart Input
Instead of one quantity selector, the cashier sees:
```
[ Units: 1 ]  [ Pills: 4 ]  = 14 pills total
```
Total pills sent to backend = `(Units × PillsPerUnit) + Pills`

### Backend Deduction — `deductPillsFEFO(productId, pillsWanted)`

```
Read from Inventory: loosePills, currentUnits (whole strips)

CASE 1 — Enough loose pills already:
  loosePills >= pillsWanted
  → Subtract from LoosePills directly
  → No sealed unit is broken
  → Log movement (type = Sale, qty = -pillsWanted)
  → DONE

CASE 2 — Need to break new units:
  pillsStillNeeded = pillsWanted - loosePills
  unitsToBreak = CEIL(pillsStillNeeded / pillsPerUnit)
  
  → deductStockFEFO(productId, unitsToBreak)   ← uses FEFO (soonest expiry first)
  
  pillsFromNewBreaks = unitsToBreak × pillsPerUnit
  newLoosePills = loosePills + pillsFromNewBreaks - pillsWanted
  
  → Update Inventory:
     CurrentStock -= unitsToBreak
     LoosePills   = newLoosePills
     LoosePillsBatchID = last batch that was broken (for traceability)
```

### Worked Example
```
Setup: CurrentStock = 5 strips, LoosePills = 3, PillsPerUnit = 10

Customer wants 7 pills:
  loosePills (3) < pillsWanted (7)
  pillsStillNeeded = 7 - 3 = 4
  unitsToBreak = CEIL(4 / 10) = 1 strip

  Deduct 1 strip from soonest-expiring batch (FEFO)
  pillsFromNewBreaks = 1 × 10 = 10
  newLoosePills = 3 + 10 - 7 = 6

  Result:
    CurrentStock = 4 strips
    LoosePills   = 6 pills
  
  Display now shows: 4 × 10 + 6 = 46 pills
```

---

## 6. How the Pill Product Form Works

To prevent errors like entering the wrong `PillsPerUnit`, the Add/Edit Product form has an **interactive pill configuration panel**.

### What triggers it
When the pharmacist checks the **"Enable sell-by-pill"** checkbox on the product form, a hidden panel slides open. When unchecked, the entire section is hidden so it doesn't distract for regular products.

### What the panel shows
Once enabled, the pharmacist fills in:
- **Number of pills in 1 sealed unit** — a clearly labelled `number` input (e.g. enter `10` for a strip of 10 tablets)

A **live 💊 Price Preview** card appears on the right and auto-updates as the pharmacist types:

| Preview Row | How it's calculated |
|---|---|
| Sealed unit price | Direct value from the Selling Price field |
| **Per individual pill** | `SellingPrice ÷ PillsPerUnit` |
| Cost per pill | `PurchasePrice ÷ PillsPerUnit` |
| Unit margin % | `(SellingPrice − PurchasePrice) ÷ PurchasePrice × 100` |
| Customer example | `3 pills → 3 × (SellingPrice ÷ PillsPerUnit)` |

### Warning banner
A yellow warning box reminds the pharmacist:
> ⚠️ Enter the **selling price per full sealed unit** (e.g. price of one full strip). The system divides by the number of pills automatically.

This ensures the pharmacist never confuses per-pill prices with per-unit prices when saving the product.

### What happens when saved
The `PillsPerUnit` value is saved to the Products sheet. From this moment, all POS calculations for this product automatically use this value to derive the per-pill price and to break strips during FEFO deduction.

---

## 7. How Inventory is Tracked (FEFO)

### The Batch System
**Inventory is never directly added or subtracted as a simple number.** Instead:
- Every purchase creates a new **Batch** row (with its own expiry date, purchase price and owning store).
- `Inventory.CurrentStock` is always the **sum of the batch quantities for that product at that store**.

```
Product: Ibuprofen (in STORE000001)
Batch BAT001: qty=50, expiry=2025-06-01, purchasePrice=8, store=STORE000001
Batch BAT002: qty=30, expiry=2026-01-15, purchasePrice=9, store=STORE000001
Batch BAT003: qty=20, expiry=2026-08-30, purchasePrice=10, store=STORE000001
                                         ─────────────────
Inventory.CurrentStock (product × STORE000001) = 100
```

### FEFO (First-Expire, First-Out) — `deductStockFEFO()`
When stock is deducted for any reason, the batches **at that store** are sorted by expiry date ascending (soonest expiry first). Stock is consumed from the soonest-expiring batch before touching newer batches.

```
Sort batches: BAT001 (Jun) → BAT002 (Jan) → BAT003 (Aug)

Customer buys 70 units:
  From BAT001: take 50 → BAT001.Quantity = 0, remaining = 20
  From BAT002: take 20 → BAT002.Quantity = 10, remaining = 0

No unexpired stock is sold before older stock, preventing waste.
```

Products with no expiry date are sorted to the very end (treated as expiring in year 2999), so they are consumed last.

### Stock Movements Log
Every time stock changes for any reason, one row is written to `StockMovements`:
```
MovementID, Date, ProductID, BatchID,
Type (OpeningStock / Purchase / Sale / Return / Adjustment /
      DamageLoss / TransferOut / TransferIn / SaleVoided /
      PurchaseDeleted / ExpiredWriteOff),
Quantity, PreviousStock, NewStock,
ReferenceType, ReferenceID, UserID, Remarks, StoreID
```
This creates a **complete, tamper-proof audit trail** of every item that has ever entered or left your inventory, in every branch.

---

## 8. How the Cash Drawer / Shifts Work

### Lifecycle of a Shift

```
START SHIFT
  cashier declares opening cash balance (e.g. ETB 500)
  → creates one row in CASH_DRAWER:
     OpeningBalance=500, CashSales=0, CardSales=0, MobileMoney=0, Expenses=0

   [Sales happen throughout the day]
   Every sale automatically calls bumpOpenDrawer():
     CashSales   += sale total  (if paid by Cash)
     CardSales   += sale total  (if paid by Card)
     MobileMoney += sale total  (if paid by Mobile Money)

END SHIFT
  cashier physically counts cash in the drawer and types the amount
  → System calculates:
     Expected = OpeningBalance + CashSales - Expenses
     Difference = CountedCash - Expected

  → System takes a permanent SNAPSHOT of every item sold during this shift
     into SHIFT_SALES (itemized per product, per cashier)

  → Closes the CASH_DRAWER row with ClosingBalance, Difference, ClosedAt
```

### Cash Reconciliation Formula
```
Expected Cash = Opening Balance + Cash Sales − Cash Expenses
Difference    = Counted Cash − Expected Cash

Positive difference → overage (cashier has more cash than expected)
Negative difference → shortage (cashier has less cash than expected)
```

### Why Shift Sales are Snapshotted
The `ShiftSales` table is a permanent, locked record. Even if a sale or product is later edited, the shift record remains unchanged. This is important for owner auditing and accountability.

---

## 9. How Returns and Refunds Work

When a customer returns an item, `createReturn(userId, saleId, productId, qty, reason)` is called.

```
1. Find the original sale and confirm the product was in it
2. Validate: returnQty ≤ original quantity sold

3. Determine if goods are resalable:
   Resalable reasons: 'Customer Changed Mind', 'Wrong Item', etc.
   Non-resalable:     'Damaged', 'Expired'

4A. IF RESALABLE:
    → Call receiveBatch() — puts stock back into inventory as a new batch
    → Stock levels increase; item can be sold again

4B. IF NOT RESALABLE:
    → Write to STOCK_MOVEMENTS with Quantity = 0 (logged but no stock added)
    → Item is recorded as a loss but NOT put back into sellable inventory

5. Write one row to RETURNS:
   ReturnID, SaleID, ProductID, Quantity, Reason, Amount, ApprovedBy

6. Subtract the refund from the cashier's open shift:
   bumpOpenDrawer(CashierID, PaymentMethod, -refundAmount)
   (This reduces the expected cash in the drawer accordingly)
```

---

## 10. How Profit is Calculated

### Today's Dashboard Profit
```
Profit = Revenue - Cost of Goods Sold - Expenses

Revenue    = SUM(Sales.GrandTotal) for today's sales
COGS       = SUM(SaleItems.Quantity × Batches.PurchasePrice) for today's sale items
             (uses the actual BATCH purchase price, not the catalog price)
Expenses   = SUM(Expenses.Amount) for today's expenses
```

> **Key point:** COGS uses the `PurchasePrice` stored in the **Batch** row at the time you received the goods, not the current catalog price. This means profit is always historically accurate even if prices have changed since.

### Line-Level Margin (POS)
When a cashier applies a margin to an item in the cart:
```
UnitPrice = PurchasePrice × (1 + MarginPercent / 100)
```

Example:
```
PurchasePrice = 100 ETB
Margin applied = 25%
UnitPrice = 100 × 1.25 = 125 ETB
Profit on one unit = 25 ETB
```

---

## 11. How Low Stock Alerts Work

The system compares each product's current stock level against a **two-tier threshold**:

```
IF product.ReorderLevel is set AND product.ReorderLevel > 0:
    Threshold = product.ReorderLevel   (per-product setting)
ELSE:
    Threshold = Settings.LowStockAlertThreshold   (global fallback)

Product is LOW STOCK if: CurrentStock <= Threshold
```

> **Why the `> 0` check?** When a product is created without filling in the Reorder Level field, the database saves it as `0`. Without this check, every such product would be flagged as low stock because `CurrentStock (e.g. 50) <= 0` is false — but older bugs stored 0 literally, so the check prevents false positives.

This is evaluated:
- **On the Dashboard:** counts how many active products are below their threshold.
- **In the Products table:** each row shows a red "Low stock" pill if below threshold.
- **In the Products filter:** the "Low stock" option in the stock status dropdown shows only these items.

---

## 12. How Product Filters Work

The Products view applies four independent filters simultaneously.

| Filter | Input element | Logic |
|---|---|---|
| **Text search** | `#inventory-search` text input | Case-insensitive match on `ProductName` OR `GenericName` |
| **Category** | `#inventory-category-filter` dropdown | Exact match on `CategoryID`; "All" shows everything |
| **Stock status** | `#inventory-stock-filter` dropdown | Matches the product's four-tier health badge |
| **Branch** | `#inventory-store-filter` dropdown | Which branch's stock to show — or all branches combined |

### Stock status filter options
```
All             → show all products
In stock        → health = ok          (quantity > threshold)
Low stock       → health = low         (threshold/2 < quantity <= threshold)
Critical stock  → health = critical    (0 < quantity <= threshold/2)
Out of stock    → health = out_of_stock (quantity = 0)
```

### How they combine
All filters are ANDed together. A product only appears in the list if it passes **every** active filter at the same time.

```javascript
var source = catalogProducts || allProducts;   // branch scope decides the data
var filtered = source.filter(function(p) {
    var matchSearch = !search ||
        p.ProductName.toLowerCase().includes(search) ||
        (p.GenericName || '').toLowerCase().includes(search);
    var matchCat = !catFilter || p.CategoryID === catFilter;
    var matchStock = /* stock status logic */;
    return matchSearch && matchCat && matchStock;
});
```

### The branch filter vs the store switcher

The **store switcher** in the top bar sets the branch the whole app is working in — that is the branch the POS sells from and the branch adjustments and purchases default to.

The **branch filter** in the Products toolbar only changes what the *catalog* shows: pick "Main Store" to inspect the main branch's stock, or "All stores" to see the combined position across every branch. The stock numbers, the KPI cards and the Adjust/Ledger actions on those rows all follow the branch you picked; the POS never does.

Filters are re-applied every time the user types or changes a dropdown — no page reload needed.

---

## 13. How Stock Adjustments & Opening Balances Work

Sometimes stock changes without a sale: a shop counts the shelf at close and finds 42 boxes instead of 40, a delivery arrives without an invoice, medicine spoils in the back room. The **Adjust Stock** screen records all of these in one audited place.

### The two entry points

| Entry point | Where | What it is for |
|---|---|---|
| Product form → **Opening stock** | Add/Edit Product | Record the starting quantity, unit cost and batch expiry for a brand-new product |
| **Adjust Stock** button | Products view (and the product card) | Record a later correction for any product: recount, damage, expiry write-off, customer return |

Both paths end up in the same place: a `StockMovements` row plus an `AuditLogs` row.

### The adjustment form

| Field | Meaning |
|---|---|
| Product | Which product is being corrected |
| Store | Which branch holds the stock |
| Movement type | Opening Balance / Manual Adjustment / Damage-Loss / Customer Return / Expired Write-off |
| Direction | **In** or **Out** — only offered when the type allows it |
| Quantity | Always positive; the direction decides the sign |
| Reason | **Mandatory** (at least 3 characters) — written to the ledger and the audit log |
| Notes, unit cost, expiry date | Optional extra detail (cost and expiry only matter for stock coming in) |

While the form is open the screen shows a **live projection**: `current stock → projected stock`, and warns before you post a removal that would take the stock below zero.

### The rules the backend enforces

```
1. PERM_ADJUST_STOCK is required.
2. The movement type decides the direction:
      Opening Balance  → in only
      Customer Return  → in only
      Damage / Loss    → out only
      Expired Write-off→ out only
      Manual Adjustment→ either (the user chooses)
3. Stock coming IN always creates a BATCH:
      → the batch keeps the cost and expiry you typed
      → an opening balance also refreshes the catalog cost price
4. Stock going OUT is taken from existing batches, FEFO within that store.
5. Damage and expiry write-offs may be posted even when nothing is on hand
   (you still lost something — the ledger records the loss and notes how
   much was actually available).
```

### Why it is built this way

The single most important rule in the whole system is **"stock is never edited directly."** Every quantity in the system arrives through a batch and a ledger entry, so the books always reconcile: *stock on hand = sum of batches = the last number in the ledger.*

---

## 14. How the Four-Tier Stock Health Works

Every product is classified into one of four health tiers, using its own reorder level when it has one and the global threshold from Settings otherwise.

```
threshold = (product.ReorderLevel > 0) ? product.ReorderLevel
                                       : Settings.LowStockAlertThreshold

qty = 0                 → out_of_stock   ("Out of stock")
0 < qty <= threshold/2  → critical       ("Critical")
threshold/2 < qty <= threshold → low      ("Low")
qty > threshold         → ok             ("In stock")
```

| Tier | Badge | Meaning |
|---|---|---|
| `out_of_stock` | red | Nothing on the shelf — reorder immediately |
| `critical` | orange | Half the reorder level or less — reorder now |
| `low` | amber | Below the reorder level — reorder soon |
| `ok` | green | Comfortably above the reorder level |

The tiers are surfaced in three places:

- **Products view** — a badge on every row, and a "Stock status" filter with `All / In stock / Low / Critical / Out of stock`.
- **Inventory KPI cards** — how many products sit in each tier.
- **Stores view** — the same counts per branch, so you can see which branch is running dry.

The classification lives in one function, `classifyStock(qty, threshold)` in `utilities.gs`, so the Products screen, the KPI cards and the store screens can never disagree.

---

## 15. How Stores & Multi-Branch Stock Work

A **store** is a physical location — a retail counter, a warehouse, a depot or a clinic — that holds its own stock.

### The data model

```
Stores ──< Batches          (each batch belongs to one store)
       ──< Inventory        (one row per product AND store)
       ──< StockMovements   (every movement is scoped to a store)
       ──< Sales            (a sale happens at one store)
       ──< Purchases        (goods are received at one store)
       ──< StoreTransfers   (from one store to another)
```

The important change: **inventory is keyed by `(ProductID, StoreID)`, not by `ProductID` alone.** The same product can sit in three branches at once, each with its own quantity and its own health badge. Every store-aware function falls back to the default store (`STORE000001`) when no store is supplied, so a single-store shop behaves exactly like before.

### The store switcher

The top bar carries a store selector. It sets the **active store**, which scopes:

- the POS product grid and its stock numbers,
- the "Receiving store" on a purchase,
- the target store of a stock adjustment,
- the product list and its stock column.

Sales History and the Stock Ledger deliberately default to **All stores**, because the owner wants the full history visible — the store filter is there when you need to narrow it down.

### Running with a single branch

Most pharmacies start with one branch. In that case:

- **Nothing changes behind the scenes.** Every store-aware function falls back to the default store (`STORE000001`, "Main Store") when no store is supplied, so products, purchases, sales, adjustments, returns and every report behave exactly as they did before multi-store support existed.
- **The branch pickers hide themselves.** The top-bar store selector, the POS store chip, the store filters in Sales History / Stock Ledger / Products / Stores, the "Receiving store" and "Home store" fields and the "Transfer stock" button are all hidden while there is only one branch — there is nothing to pick.
- **They come back on their own.** Add a second branch from the Stores screen and every one of those controls reappears immediately; no setting, no code change, no restart. Deactivate that branch again and they disappear once more.

A deactivated branch can never be selected for new sales, purchases or adjustments — it stays visible on the Stores screen for its history, marked *Inactive*.

### The Stores screen

Each branch card shows:

- the number of units on hand and the stock value at cost,
- the four health-tier counts (out of stock / critical / low / in stock),
- how much stock moved in and out over the last 30 days,
- revenue and transaction count over a date range.

From here you can add a branch, edit its details (code, type, address, phone, manager, opening date), deactivate it, inspect its stock list, and transfer stock to another branch.

> A branch can only be deactivated once it holds **zero** stock — transfer the remainder out first, so nothing is ever silently orphaned.

### Transfers

Moving stock between branches posts a **matched pair** of ledger entries under one TransferID:

```
Transfer 5 units of Amoxicillin from STORE000001 to STORE000002

SOURCE (STORE000001)                    DESTINATION (STORE000002)
  TransferOut  −5  (TRF000007)           TransferIn  +5  (TRF000007)
  batch BAT000012 qty 5 → 0              new batch BAT000021 qty 5
                                         expiry date copied from BAT000012
```

Why a new batch on the destination instead of just moving the row? Because the destination needs its own expiry date to keep FEFO working, and because each branch must be able to value and close its own stock independently. The `StoreTransfers` table keeps a human-readable record (from, to, product, quantity, value, reason, who did it).

---

## 16. How the Stock Ledger Works

The **Stock Ledger** view is the append-only history of every quantity change in the system — the answer to "why is the stock number what it is?".

### Every movement type

| Type | Posted when | Direction |
|---|---|---|
| `OpeningStock` | A product is created with a starting balance, or an opening balance is recorded later | In |
| `Purchase` | Goods are received from a supplier | In |
| `Sale` | A product is sold at the POS | Out |
| `Return` | A customer returns goods | In |
| `Adjustment` | A manual recount or correction | In / Out |
| `DamageLoss` | Stock is damaged, spoiled or stolen | Out |
| `ExpiredWriteOff` | Expired stock is written off | Out |
| `TransferOut` | Stock leaves a branch | Out |
| `TransferIn` | Stock arrives at a branch | In |
| `SaleVoided` | A sale is voided and the stock comes back | In |
| `PurchaseDeleted` | A purchase is deleted and the stock is reversed | Out |

### The filters

| Filter | Searches / matches |
|---|---|
| Product | One product's history |
| Movement type | One type (e.g. all transfers) |
| Store | One branch (or all stores) |
| Date range | From / to, inclusive of whole days |
| Free text | Product name, type, remarks/reason, reference id, batch id, user name |

Results are sorted newest-first and paginated (25 per page by default). Each row shows the direction (+/−), the quantity, the previous and new stock, the store, the user and the reason.

---

## 17. How Sales History Search & Filtering Works

The **Sales History** view shows the **complete** transaction log — every sale ever made, not just the recent ones — and gives you several ways to find the one you are looking for.

### The filter bar

| Filter | Behaviour |
|---|---|
| Search box | Free text over sale id, invoice number, customer id, customer name, customer phone, cashier name and the **names of the products sold** |
| Date range | From / to, inclusive of whole days |
| Payment method | Cash / Card / Mobile Money |
| Status | Completed / Voided / Deleted |
| Cashier | One user (dropdown built from `getSalesCashiers()`) |
| Store | One branch, or all stores |
| Min / max total | Amount range |
| Sort | By date or by total, ascending or descending |

Each active filter appears as a removable **chip** under the bar, so you can see at a glance what is narrowing the list.

### What comes back

```
{
  sales: [ ...the current page... ],
  total: 137,            // rows matching the filter
  page: 1, pageSize: 25, pages: 6,
  summary: { count: 137, totalAmount: 48250.00, from: '...', to: '...' }
}
```

The summary strip above the table shows how many transactions matched and what they add up to — the same numbers regardless of which page you are on.

### Why the search is server-side

The Sheets database is read row by row, so filtering in the browser would mean shipping the entire transaction history to the client on every keystroke. Filtering and paging happen in `getSales()` on the backend, and the frontend only ever holds the 25 rows it is currently showing. Guarded loaders also make sure a slow response can never overwrite a newer one.

### Drilling down

Clicking a row opens the sale detail modal: the header (invoice, cashier, customer, store, payment, totals), every line item with its batch, unit price, margin used and tax, plus the actions for printing a receipt or starting a return on an item.

---

## 18. Database Tables Reference

| Table | Purpose |
|---|---|
| `Stores` | Branches / outlets / warehouses that hold their own stock |
| `StoreTransfers` | One row per stock movement between branches |
| `Products` | Master catalog: names, prices, margins, pill config, home store |
| `Inventory` | Rollup of current stock per product **and store** (derived from Batches) |
| `Batches` | Source of truth: every stock parcel with its own expiry, cost and store |
| `StockMovements` | Immutable audit log of every single stock change |
| `Sales` | One row per checkout transaction |
| `SaleItems` | Line items per sale, linked to the specific batch consumed |
| `Purchases` | One row per supplier restock order |
| `PurchaseItems` | Line items per purchase, linked to the created batch |
| `Returns` | Customer return events |
| `Payments` | Payments made to suppliers |
| `Expenses` | Manual expense entries |
| `Income` | Manual non-sale income entries |
| `CashDrawer` | One row per cashier shift |
| `ShiftSales` | Itemized snapshot of what was sold in each shift |
| `Customers` | Customer directory |
| `Suppliers` | Supplier directory with outstanding balance |
| `Users` | System users and their assigned roles |
| `Roles` | Named roles (Owner, Pharmacist, Cashier) |
| `Permissions` | The 24 permission ids |
| `RolePermissions` | Which role holds which permission |
| `AuditLogs` | Records who changed what and when |
| `Settings` | Global system configuration (VAT, thresholds, etc.) |

---

## 19. Critical Design Decisions

### Concurrency Locks
Every write operation that modifies inventory (sales, purchases, returns, stock adjustments, transfers) acquires a **Script Lock** for up to 15 seconds. This prevents two cashiers processing sales at the exact same moment from both reading "10 units in stock" and both successfully selling 10, resulting in -10 stock.

### Batches Are the Source of Truth
`Inventory.CurrentStock` is always recomputed as `SUM(Batches.Quantity)` for that product **at that store**. It is never decremented directly. This prevents stock drift and makes the system fully auditable.

### One Audited Entry Point for Manual Corrections
Opening balances, recounts, damage, expiry write-offs and customer returns all go through `recordStockAdjustment()`. One function means one place where the permission check, the reason requirement, the batch handling and the ledger entry are enforced — there is no second, laxer path into the stock numbers.

### Transfers Post a Matched Pair
A transfer writes a `TransferOut` on the source and a `TransferIn` on the destination under one TransferID. Both halves are permanent, and the destination receives a new batch carrying the source expiry so FEFO keeps working there.

### Single-Store Installations Keep Working
Every store-aware function resolves a missing store id to `DEFAULT_STORE_ID`. Nothing about the behaviour of a one-branch pharmacy changes; branches simply become available when you want them — and the branch pickers only appear once a second branch actually exists.

### The Owner Sees Everything
`hasPermission()` short-circuits for the Owner, and the Owner is also handed the full permission list at login, so permission-gated navigation never hides a screen from the person who is allowed to use everything.

### Filter and Page on the Server
Sales history and the stock ledger filter and paginate inside the backend. The browser only ever receives the page it is showing, which keeps Apps Script responses small and fast even with years of transactions.

### Sell Price is Stored Per Batch
When a purchase is received, the selling price is locked into the Batch row. Even if you later change the catalog selling price, the COGS for that batch remains historically correct in your reports.

### Soft-Delete for Purchases
Purchases are never hard-deleted. They are marked `RecordStatus = 'Deleted'` and excluded from reports. The stock deduction from the deleted purchase is reversed, but the record remains for auditing.

### Permission Gating on Every Function
No backend function can be called without first checking `authorize(userId, PERMISSION)`. The frontend cannot bypass this because the user has no way to impersonate another `userId` — the `userId` is stored only in the server-side session (via `ScriptProperties` or the session mechanism).

---

## Contact & Developer Info

Developed by **Yonas Mindaye**  
- Telegram: [@yona64](https://t.me/yona64)
- Phone/WhatsApp: [0910011818](https://wa.me/2510910011818)
- Email: [yonasmindaye04@gmail.com](mailto:yonasmindaye04@gmail.com)
- Website: [afro-tech-et.vercel.app](https://afro-tech-et.vercel.app/)
