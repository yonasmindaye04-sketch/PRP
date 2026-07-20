# Pharmacy ERP — System Design (v1)

## 1. What changed from v0 → v1

v0 proved the pattern (Sheets-as-DB, Apps Script backend, single HTML frontend)
with a flat, denormalized schema. v1 replaces that with the fully normalized,
28-table schema we designed, so the system now supports **batches & expiry
tracking, purchasing, suppliers, customers, cash drawer reconciliation,
expenses/income, returns, and data-driven roles/permissions** — without ever
needing another schema rewrite.

## 2. Database analysis — what was fixed in `Pharmacy_Database_v1.xlsx`

Auditing the workbook you uploaded against the 28-table design:

| Issue found | Fix applied |
|---|---|
| `Products` still had the old v0 flat schema (`Name`, `Category` as text, `Qty`, `Cost`, `Price`) | Rewritten to the normalized schema: `Barcode, ProductName, GenericName, Brand, CategoryID, Unit, Strength, DosageForm, PurchasePrice, SellingPrice, TaxRate, MinimumStock, MaximumStock, ReorderLevel, SupplierID, Active, CreatedDate, UpdatedDate, CreatedBy`. Stock now lives in `Inventory`/`Batches`, not on the product row. |
| `Categories` table was missing entirely | Added, seeded with the 5 example categories from the design doc. |
| `Prescriptions` / `PrescriptionItems` were missing | Added (empty — optional module, wired into the schema but not into v1 screens; see §6). |
| `StockMovements` had leftover documentation rows (`Type` filled in, everything else blank) | Cleared to header-only — those were template rows, not data. |
| `Settings` had a blank row after every key (artifact of the markdown table paste) | Rebuilt as clean `Setting | Value` pairs, one row per key, with sensible defaults (`Currency: ETB`, `VATRate: 15`, etc. — change these to match your business). |
| `Roles` / `Permissions` / `RolePermissions` existed as empty structure only | Seeded with the actual Owner/Pharmacist/Cashier roles, 21 permissions, and the role→permission matrix — **this is what makes permissions data-driven instead of hardcoded** in v1 (see §4). |
| `Cash Drawer` / `Business Information` had spaces in the sheet name | Renamed to `CashDrawer` / `BusinessInfo` — spaces in sheet names are legal but make `getSheetByName()` calls in code error-prone and inconsistent with every other table. |
| Sheet order was arbitrary | Reordered to match the recommended folder structure (config tables first, then catalog, then transactions, then logs). |

Everything else (`Suppliers`, `Users`, `AuditLogs`, `Sales`, `SaleItems`,
`Purchases`, `PurchaseItems`, `Customers`, `Expenses`, `Income`, `Batches`,
`Inventory`, `Payments`, `Returns`, `Notifications`, `ActivityLog`,
`DashboardCache`) already matched the target schema exactly and was left as-is.

## 3. Architecture

```
HTML/CSS/JS Frontend (Index.html)
        │  google.script.run
Apps Script Backend — one .gs file per module
        │
        ├─ database.gs   (generic sheet read/write — the ONLY file that
        │                  touches Range objects)
        ├─ auth.gs        (login + data-driven permission checks)
        ├─ categories.gs, suppliers.gs, customers.gs, users.gs  (masters)
        ├─ products.gs    (product catalog + batches + inventory rollup)
        ├─ purchases.gs   (purchase → batches → stock movement → supplier balance)
        ├─ sales.gs       (POS → FEFO batch pick → stock movement → cash drawer)
        ├─ returns.gs      (sale return → restock or discard → refund)
        ├─ finance.gs      (expenses, income, supplier payments, cash drawer)
        ├─ dashboard.gs    (summary metrics + low-stock/expiry alerts)
        ├─ settings.gs     (Settings + BusinessInfo, cached)
        └─ utilities.gs    (IDs, hashing, audit log, activity log, cache helpers)
        │
Google Sheets — 28 tables, IDs as foreign keys throughout
```

**Why this shape:** every module owns exactly one concern and never reaches
into another module's sheets directly — `sales.gs` doesn't touch `Products`
rows itself, it calls `products.gs`'s `getProductById()` /
`adjustBatchQuantity()`. That's what lets you later swap Sheets for Cloud SQL
or Firestore by rewriting `database.gs` alone.

## 4. Permissions are now data, not code

v0 hardcoded a `PERMISSIONS` object in `constants.gs`. v1 reads `Roles`,
`Permissions`, and `RolePermissions` from the sheet instead, cached in
`CacheService` for 30 minutes so a permission check doesn't cost a sheet
read on every click:

```
authorize(userId, 'PERM_SELL')
   → look up user's RoleID (Users sheet)
   → look up cached RoleID → [PermissionID...] map (RolePermissions sheet)
   → allow/deny
```

This means you can add a new role or tweak what a Pharmacist can do by
**editing the sheet**, not redeploying code. Cache is invalidated
automatically 30 minutes after a change, or immediately via
`clearPermissionCache()` if you want it instant after an edit.

## 5. Core data flows

**Purchasing (goods in):**
`Purchase` header + `PurchaseItems` lines → for each line, create/update a
`Batches` row (batch number, expiry, purchase/selling price) → write a
`StockMovements` row (`Type=Purchase`) → bump `Inventory.CurrentStock` for
that product → update `Suppliers.CurrentBalance`.

**Selling (goods out) — FEFO:**
Cart of `{productId, qty}` → for each line, pull that product's batches
**ordered by soonest expiry first** and deduct across as many batches as
needed → write one `StockMovements` row per batch touched (`Type=Sale`) →
`SaleItems` records which `BatchID` supplied each unit (so a recalled batch
can be traced to exact receipts) → `Inventory.CurrentStock` decremented →
`CashDrawer` running total updated for the cashier's open shift.

**Returns:** looks up the original `SaleItems` row, restocks the same
`BatchID` (or marks it `Damage`/`Expired` if not resalable), writes a
`StockMovements` row, and logs the refund amount.

**Cash Drawer:** a cashier opens a shift (`OpeningBalance`), every cash sale
adds to `CashSales` automatically as sales are created, and closing the
shift compares `ClosingBalance` (counted cash) against the expected total
and records `Difference`.

## 6. What's implemented in v1 vs. deferred

**Implemented, production-usable:**
Categories, Suppliers, Customers, Users/Roles/Permissions, Products +
Batches + Inventory rollup, Purchases, POS/Sales with FEFO, Returns,
Expenses/Income, Supplier Payments, Cash Drawer, Settings/BusinessInfo,
Dashboard with low-stock + expiry alerts, AuditLogs + ActivityLog.

**Schema is ready, screens are deferred to v1.1** (add a `.gs` file + a view
in `Index.html`, no schema change needed):
- Prescriptions / PrescriptionItems (only needed if you dispense against
  doctor's prescriptions)
- Notifications as a persisted, dismissible inbox (v1 computes alerts live
  on the dashboard instead of writing to the `Notifications` table)
- `DashboardCache` — v1 computes dashboard numbers live each load, which is
  fine up to a few thousand rows per table; once that gets slow, write
  dashboard metrics into `DashboardCache` on each sale/purchase instead of
  recomputing from scratch.
- Multi-branch, barcode scanning hardware integration, receipt printing.

## 7. Setup

1. Upload `Pharmacy_Database_v1.xlsx` to Google Drive and open it as a
   Google Sheet (File → Save as Google Sheets, or just open it — Drive
   converts it automatically). Copy its ID from the URL.
2. Extensions → Apps Script. Create each `.gs` file and the `Index` HTML
   file listed below, pasting in the matching contents.
3. Paste the Spreadsheet ID into `SPREADSHEET_ID` in `constants.gs`.
4. Run `initializeSystem` once (Apps Script editor → function dropdown →
   Run). It verifies every sheet/header exists (it won't overwrite your
   seeded data) and creates the first login if `Users` is empty.
5. Deploy → New deployment → Web app → Execute as "Me" → Access "Anyone
   with the link" (or your Workspace domain). Open the URL and log in.
