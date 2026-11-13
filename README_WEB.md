# Pharmacy ERP — Web Version

A modern web-based pharmacy management system built with **React + Vite** (frontend), **Express** (backend API), and **PostgreSQL** (database). This is the web replacement for the Google Apps Script / Google Sheets pharmacy system.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, React Router 6, Recharts, Axios, React Hot Toast, React Icons |
| Backend | Node.js, Express 4, PostgreSQL (pg), JWT auth, bcryptjs, express-validator, helmet, cors |
| Database | PostgreSQL (roles, users, products, batches, sales, purchases, finance, etc.) |

## Project Structure

```
PPR/
├── backend/                  # Express + PostgreSQL API
│   ├── migrations/           # SQL schema migrations + runner
│   ├── seeders/              # Initial data (roles, permissions, admin, sample products)
│   └── src/
│       ├── config/           # DB pool configuration
│       ├── controllers/      # Auth, Products, Sales, Purchases, Returns, Finance, Users, Masters, Dashboard
│       ├── middleware/       # JWT auth, permission checks, error handling
│       ├── routes/           # REST API routes for all modules
│       └── index.js          # Express app entry point
├── frontend/                 # React + Vite SPA
│   └── src/
│       ├── api/              # Axios client with JWT refresh
│       ├── components/       # Layout, ProtectedRoute, Common UI
│       ├── context/          # AuthContext (login, permissions)
│       ├── pages/            # Dashboard, POS, SalesHistory, Products, Purchases,
│       │                     # Suppliers, Customers, Finance, CashDrawer, Users, Settings
│       ├── styles/           # Global CSS
│       └── App.jsx           # Routes & permission gating
└── package.json              # Root scripts (dev, migrate, seed)
```

## Features

- **Authentication & RBAC** — JWT tokens, role-based permissions (Owner / Pharmacist / Cashier), permission-gated UI and backend enforcement
- **Dashboard** — Sales/expense/profit cards, sales & profit trends, top products, category breakdown, low-stock & expiry alerts
- **Point of Sale (POS)** — Product grid with categories & search, cart with margin dropdowns, sell-by-pill (Units + Pills) support, dynamic pricing, receipt printing
- **Sales History** — Filterable transaction list with drill-down and returns/refunds
- **Products** — Catalog CRUD, batches with expiry dates, FEFO (First-Expiry-First-Out) stock deduction, pill-selling config
- **Purchases** — Purchase orders that create batches and update stock, supplier balances, owner-only delete with reason
- **Suppliers / Customers** — Master data CRUD
- **Finance** — Expenses, income, supplier payments
- **Cash Drawer** — Shift-based management (start/end, expected vs counted cash)
- **Users & Settings** — User management, password reset, business info, margin presets

## Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [PostgreSQL](https://www.postgresql.org/) v14+

## Setup

### 1. Create the database

```sql
CREATE DATABASE pharmacy_erp;
```

### 2. Configure environment

Copy and edit the env files:

```bash
copy backend\.env.example backend\.env    # Windows
# OR
cp backend/.env.example backend/.env      # Mac/Linux
```

Edit `backend/.env` with your PostgreSQL credentials and JWT secret.

### 3. Install dependencies

```bash
npm install                  # root (concurrently)
npm run install:all          # backend + frontend
```

### 4. Run migrations & seed

```bash
npm run setup:db
```

This creates all tables and seeds:
- Roles, 21 permissions, role-permission matrix
- Admin user: `admin` / `ChangeMe123`
- 5 sample products with opening batches & inventory
- 5 categories, 3 suppliers, system settings

### 5. Start the app

```bash
npm run dev                  # starts backend (port 3000) + frontend (port 5173)
```

Open http://localhost:5173 and log in with `admin` / `ChangeMe123`.

## API Overview

| Module | Base Path | Key Endpoints |
|---|---|---|
| Auth | `/api/auth` | POST `/login`, `/refresh`, GET `/profile` |
| Products | `/api/products` | GET, POST, PUT, DELETE + `/categories`, `/suppliers` |
| Sales | `/api/sales` | POST (create sale), GET list, GET `/:id`, GET `/summary` |
| Purchases | `/api/purchases` | POST, GET, GET `/:id`, DELETE |
| Returns | `/api/returns` | POST, GET |
| Finance | `/api` | `/expenses`, `/income`, `/payments`, `/cashdrawer/*` |
| Users | `/api` | `/users`, `/roles`, `/permissions`, `/audit-logs` |
| Masters | `/api` | `/settings`, `/business-info`, `/customers` |
| Dashboard | `/api/dashboard` | `/summary`, `/sales-trend`, `/top-products`, `/profit-trend`, etc. |

## Key Business Logic

- **FEFO stock deduction** (`salesController.js`) — batches are consumed by soonest expiry first; pill products break strips automatically
- **Dynamic pricing** — POS cart sends per-line `unitPrice` + `marginUsed`; backend records actual margin per sale item for profitability
- **Auto price update on restock** — if a purchase raises the unit cost, the selling price is recalculated from the product's default margin
- **Inventory is derived** — `inventory.current_stock` is always recomputed from `batches`, never edited directly
- **Cash drawer auto-updates** — sales/returns/expenses bump the open shift totals automatically

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run backend + frontend concurrently |
| `npm run dev:backend` | Backend only (port 3000) |
| `npm run dev:frontend` | Frontend only (port 5173) |
| `npm run migrate` | Run DB migrations |
| `npm run seed` | Seed initial data |
| `npm run setup:db` | Migrate + seed |
| `npm run build` | Production build of frontend |

---

Developed by **Yonas Mindaye**
- Telegram: [@yona64](https://t.me/yona64)
- Phone/WhatsApp: [0910011818](https://wa.me/2510910011818)
- Email: [yonasmindaye04@gmail.com](mailto:yonasmindaye04@gmail.com)
