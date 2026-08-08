# Pharmacy ERP

A full-featured pharmacy management system. This project originated as a **Google Sheets + Apps Script** monolithic application and has now been fully modernized into a **Node.js backend** with a **Vite + React single-page frontend** while preserving its praised design and features.

---

## 📚 Documentation
Please refer to our dedicated documentation files for in-depth project details:
- [**RULES.md**](docs/RULES.md) - Coding standards, UI parity rules, and CSS guidelines.
- [**STRUCTURE.md**](docs/STRUCTURE.md) - Project directory and key component overview.
- [**DECISIONS.md**](docs/DECISIONS.md) - Architectural Decisions Record (ADRs).
- [**CHANGELOG.md**](docs/CHANGELOG.md) - Version history and recent overhauls.

---

## Running the Application
### Backend
Make sure your backend server is running before attempting to use the frontend, otherwise you will encounter an Axios `timeout of 30000ms exceeded` error.
```bash
cd backend
npm install
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Features

| Module | What it does |
|---|---|
| **Authentication & Roles** | Login with SHA-256 password hashing. Three data-driven roles (Owner, Pharmacist, Cashier) with granular permissions stored in the database. |
| **Dashboard** | Today's sales, transactions, expenses, profit, low-stock alerts, expiry alerts. Sales trend, top products, category breakdown, month-over-month and year-over-year comparison charts. Low-stock threshold uses per-product ReorderLevel when set and > 0, otherwise falls back to the global LowStockAlertThreshold from Settings. |
| **POS (Point of Sale)** | Tap-to-add product grid with search and category filter. Cart with qty controls, custom free-text margin input (type any margin %, not just preset values), discount, tax, customer selection, and three payment methods (Cash / Card / Mobile Money). FEFO batch deduction. |
| **Pill Selling** | Products can be configured to sell by individual pill. The POS cart shows Units + Pills dual inputs for sell-by-pill products, letting the pharmacist enter partial strips naturally (e.g. 1 unit + 4 pills). The per-pill price is automatically derived as SellingPrice divided by PillsPerUnit. The system tracks loose pills per product with FEFO batch traceability. |
| **Pill Product Configuration** | The Add/Edit Product form has a dedicated interactive pill configuration panel with a toggle checkbox. When enabled it reveals a clearly-labelled Number of pills in 1 sealed unit field and a live Price Preview card that auto-calculates per-pill price, cost-per-pill, margin %, and a customer example as the pharmacist types — preventing data entry errors. |
| **Auto Price Update on Restock** | When receiving a purchase at a higher unit cost than the current catalog price, the system automatically updates the product's PurchasePrice and recalculates SellingPrice using the product's DefaultMargin (NewCost multiplied by (1 + DefaultMargin/100)). If a selling price is manually typed in the purchase form, it takes priority. |
| **Custom Profit Margin** | Cashiers can type any custom margin % (e.g. 12.5, 42) directly into the margin input in the POS cart. The unit price and subtotal update live. |
| **Product Filters** | The Products view supports three simultaneous filters: text search (by product name or generic name), category dropdown, and stock status (All / In stock / Low stock / Out of stock). All three work in combination. |
| **Margin Management** | Each product has a configurable default margin (%). For standard products, price = PurchasePrice times (1 + margin/100). For sell-by-pill products, this is divided by PillsPerUnit to get the per-pill price. The MarginUsed is recorded on each SaleItems row for profitability analysis. |
| **Sales History** | Transaction list with drill-down detail view showing margin used per item, and item-level return initiation. Printable receipts via `@media print`. |
| **Products & Inventory** | Full product catalog (name, generic, brand, category, strength, dosage form, pricing, reorder levels, default margin, pills-per-unit, sell-by-pill flag). Stock is never edited directly — every change goes through Batches and is logged in StockMovements. |
| **Purchases** | Multi-line purchase orders against suppliers. Each line creates a Batch, bumps Inventory, logs a StockMovement, adjusts the supplier's running balance, and auto-updates catalog prices if the new cost is higher. Soft-delete (Owner-only) with stock reversal. |
| **Returns** | Sale returns with reason codes. Resalable items go back as a new batch; damaged/expired items are logged but not restocked. Refund amount is tracked against the cash drawer. |
| **Suppliers** | Master data with contact info, tax number, payment terms, and a running balance that tracks credit/debit. |
| **Customers** | Customer records with loyalty points and credit balance fields. |
| **Finance** | Expenses (categorized), non-sales Income, and Supplier Payments (optionally tied to a specific purchase order). |
| **Cash Drawer** | Shift-based cash management. Start shift with opening balance; every sale bumps the running totals. End shift records counted cash, computes the difference, and snapshots itemized ShiftSales. |
| **Users** | Staff management — create, enable/disable, reset passwords. Role assignment with permission-gated UI. |
| **Settings** | Business info (name, license, tax ID, address) and system defaults (currency, VAT rate, low-stock threshold, expiry alert days, receipt header/footer, margin presets). |
| **Audit Log** | Every significant action (login, create, update, delete, sale, purchase, payment, stock change) is logged with timestamp, user, and details. |

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

---

## Contact & Developer Info

Developed by **Yonas Mindaye**  
- Telegram: [@yona64](https://t.me/yona64)
- Phone/WhatsApp: [0910011818](https://wa.me/2510910011818)
- Email: [yonasmindaye04@gmail.com](mailto:yonasmindaye04@gmail.com)
- Website: [afro-tech-et.vercel.app](https://afro-tech-et.vercel.app/)
