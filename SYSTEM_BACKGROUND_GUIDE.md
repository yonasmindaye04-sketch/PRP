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
8. [How the Cash Drawer / Shifts Work](#8-how-the-cash-drawer--shifts-work)
9. [How Returns and Refunds Work](#9-how-returns-and-refunds-work)
10. [How Profit is Calculated](#10-how-profit-is-calculated)
11. [How Low Stock Alerts Work](#11-how-low-stock-alerts-work)
12. [How Product Filters Work](#12-how-product-filters-work)
13. [Database Tables Reference](#13-database-tables-reference)
14. [Critical Design Decisions](#14-critical-design-decisions)

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
  ├── Products
  ├── Inventory
  ├── Batches          ← source of truth for stock
  ├── Sales / SaleItems
  ├── Purchases / PurchaseItems
  ├── StockMovements   ← full audit log of every stock change
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
- Every purchase creates a new **Batch** row (with its own expiry date and purchase price).
- `Inventory.CurrentStock` is always the **sum of all batch quantities** for a product.

```
Product: Ibuprofen
Batch BAT001: qty=50, expiry=2025-06-01, purchasePrice=8
Batch BAT002: qty=30, expiry=2026-01-15, purchasePrice=9
Batch BAT003: qty=20, expiry=2026-08-30, purchasePrice=10
                                         ─────────────────
Inventory.CurrentStock = 100
```

### FEFO (First-Expire, First-Out) — `deductStockFEFO()`
When stock is deducted for any reason, the batches are sorted by expiry date ascending (soonest expiry first). Stock is consumed from the soonest-expiring batch before touching newer batches.

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
Type (Purchase / Sale / Return / Damaged / Adjustment),
Quantity, PreviousStock, NewStock,
ReferenceType, ReferenceID, UserID, Remarks
```
This creates a **complete, tamper-proof audit trail** of every item that has ever entered or left your inventory.

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

The Products view applies three independent filters simultaneously on the in-memory `allProducts` array (loaded once on page open).

| Filter | Input element | Logic |
|---|---|---|
| **Text search** | `#inventory-search` text input | Case-insensitive match on `ProductName` OR `GenericName` |
| **Category** | `#inventory-category-filter` dropdown | Exact match on `CategoryID`; "All" shows everything |
| **Stock status** | `#inventory-stock-filter` dropdown | Compares `CurrentStock` against the product's threshold |

### Stock status filter options
```
All         → show all products
In stock    → CurrentStock > threshold
Low stock   → 0 < CurrentStock <= threshold
Out of stock → CurrentStock <= 0
```

### How they combine
All three filters are ANDed together. A product only appears in the list if it passes **all three** active filters at the same time.

```javascript
var filtered = allProducts.filter(function(p) {
    var matchSearch = !search ||
        p.ProductName.toLowerCase().includes(search) ||
        (p.GenericName || '').toLowerCase().includes(search);
    var matchCat = !catFilter || p.CategoryID === catFilter;
    var matchStock = /* stock status logic */;
    return matchSearch && matchCat && matchStock;
});
```

Filters are re-applied every time the user types or changes a dropdown — no page reload needed.

---

## 13. Database Tables Reference

| Table | Purpose |
|---|---|
| `Products` | Master catalog: names, prices, margins, pill config |
| `Inventory` | Rollup of current stock per product (derived from Batches) |
| `Batches` | Source of truth: every stock parcel with its own expiry and cost |
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
| `Roles` | Permission bitmasks per role |
| `AuditLog` | Records who changed what and when |
| `Settings` | Global system configuration (VAT, thresholds, etc.) |

---

## 14. Critical Design Decisions

### Concurrency Locks
Every write operation that modifies inventory (sales, purchases, returns) acquires a **Script Lock** for up to 15 seconds. This prevents two cashiers processing sales at the exact same moment from both reading "10 units in stock" and both successfully selling 10, resulting in -10 stock.

### Batches Are the Source of Truth
`Inventory.CurrentStock` is always recomputed as `SUM(Batches.Quantity)` for that product. It is never decremented directly. This prevents stock drift and makes the system fully auditable.

### Sell Price is Stored Per Batch
When a purchase is received, the selling price is locked into the Batch row. Even if you later change the catalog selling price, the COGS for that batch remains historically correct in your reports.

### Soft-Delete for Purchases
Purchases are never hard-deleted. They are marked `RecordStatus = 'Deleted'` and excluded from reports. The stock deduction from the deleted purchase is reversed, but the record remains for auditing.

### Permission Gating on Every Function
No backend function can be called without first checking `authorize(userId, PERMISSION)`. The frontend cannot bypass this because the user has no way to impersonate another `userId` — the `userId` is stored only in the server-side session (via `ScriptProperties` or the session mechanism).
