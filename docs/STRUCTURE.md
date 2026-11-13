# Project Structure

The Pharmacy ERP is split into two primary segments: a Node.js backend API and a React frontend, replacing the legacy monolithic AppScript structure while maintaining its functional and UI paradigms.

## Repository Layout
```text
PPR/
├── backend/                  # Node.js backend API
│   ├── src/                  # Source files for controllers, routes, models
│   ├── migrations/           # Database migration files
│   ├── seeders/              # Database seeders
│   └── server.js             # Entry point
│
├── frontend/                 # Vite + React single-page application
│   ├── src/
│   │   ├── api/              # Axios client configuration (client.js)
│   │   ├── components/       # Shared UI components (Common.jsx, Layout.jsx)
│   │   ├── context/          # Global state contexts (AuthContext.jsx)
│   │   ├── pages/            # Page-level components (Dashboard, POS, Settings...)
│   │   ├── App.jsx           # Main React Router configuration
│   │   └── index.css         # Global CSS variables and structural rules
│   └── vite.config.js        # Vite configuration (including API proxy setup)
│
├── docs/                     # Project documentation
│   ├── RULES.md              # Coding and UI guidelines
│   ├── CHANGELOG.md          # Version history
│   ├── STRUCTURE.md          # This file
│   └── DECISIONS.md          # Architecture Decision Records
│
├── Index.html                # Legacy AppScript frontend code (Reference)
└── README.md                 # Project introduction
```

## Key Frontend Components
- **`Layout.jsx`**: The main application shell (`#app-shell`), managing the sidebar navigation, user session logout, and rendering the active `<Outlet />`.
- **`Common.jsx`**: Reusable micro-components like `<Modal />`, `<Loading />`, `<Badge />` (mapped to `.pill`), and `formatCurrency`.
- **`AuthContext.jsx`**: Handles the JWT lifecycle, permissions evaluation (`hasPermission()`), and global user state.
