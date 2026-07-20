# Pharmacy System — v0 (Core Infrastructure + POS + Inventory)

This is the "zero version" built on the architecture we outlined: Google Sheets
as the database, Apps Script as the backend, a single HTML/JS frontend talking
to it through `google.script.run`. It covers phases 1–3 of the roadmap
(core infrastructure, inventory, sales/POS) so it's a usable, real POS —
not a mockup — that you can grow from here.

## What's included

- **Login & roles** — Owner, Pharmacist, Cashier, with a server-side
  permission check on every action (`auth.gs`). The frontend hides buttons
  the role can't use, but the backend enforces it independently.
- **Database layer** (`database.gs`) — generic read/write/update functions
  over Sheets, so nothing else in the app touches a Range directly. This is
  the seam you'd cut along later if you migrate off Sheets.
- **Inventory** (`inventory.gs`) — products with cost/price/stock/reorder
  level, soft-delete, and a full `StockMovements` audit trail. Stock is never
  edited in place — every change is a logged movement.
- **Sales / POS** (`sales.gs`) — cart-based checkout, stock validation before
  committing, `LockService` so two cashiers can't oversell the same item,
  and a Sales + SaleItems history.
- **Dashboard** — today's sales, transaction count, low-stock count, and
  profit (Owner/Pharmacist only).
- **Audit logging** (`utilities.gs`) — every login, sale, and inventory
  change is written to `AuditLogs`.

## Setup (5 minutes)

1. **Create the database.** Make a new Google Sheet, copy its ID from the
   URL (the string between `/d/` and `/edit`).
2. **Create the Apps Script project.** In the Sheet: Extensions → Apps
   Script. Delete the default `Code.gs` content.
3. **Copy in the files from this folder** — create matching files in the
   Apps Script editor (`Code.gs`, `constants.gs`, `database.gs`, `auth.gs`,
   `inventory.gs`, `sales.gs`, `utilities.gs`, `setup.gs`, and an HTML file
   named `Index`) and paste each file's contents in.
4. **Paste your Spreadsheet ID** into `SPREADSHEET_ID` at the top of
   `constants.gs`.
5. **Run setup once.** In the Apps Script editor, pick `initializeDatabase`
   from the function dropdown (top toolbar) and click Run. Approve the
   permissions prompt. Check *View → Logs* — it prints your first login
   (`admin` / `ChangeMe123`) and confirms 3 sample products were seeded.
6. **Deploy → New deployment → Web app.** Execute as "Me", access "Anyone
   with the link" (or "Anyone within [your org]" if you're on Workspace).
   Open the resulting URL.
7. **Log in as `admin` / `ChangeMe123`**, then go to Users and create real
   Owner/Pharmacist/Cashier logins for your staff. Change or remove the
   default admin password by editing the `Users` sheet's `PasswordHash`
   directly (or re-run a small script calling `hashPassword('newpass')`).

## Loading your real product data

Once you have your Excel export ready, the fastest path is: build the SQL/
CSV-style rows in the shape of the `Products` header row
(`ProductID, Name, Barcode, Category, Unit, Cost, Price, Qty, MinQty, Expiry,
Supplier, Active, CreatedAt, UpdatedAt`) and paste them directly into the
`Products` sheet below the header — no script needed for a one-time import.
Just make sure `ProductID` values follow the `MED000001` pattern so
`nextId()` keeps counting from the right place afterward.

## What v0 deliberately leaves out (see the roadmap)

- Tax rate / receipt printing / barcode scanning
- Purchases & supplier balances (Phase 4)
- Expenses, cash drawer, daily/monthly closing (Phase 5)
- Charts, exports, cashier performance reports (Phase 6)
- Multi-branch support, automated backups (Phase 8)

The database layer, permission map, and stock-movement pattern are already
in place so each of these phases is additive — new sheets and new `.gs`
files — rather than a rewrite.
