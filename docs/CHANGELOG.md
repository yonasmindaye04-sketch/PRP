# Changelog

All notable changes to the Pharmacy ERP system will be documented in this file.

## [Unreleased]
### Added
- **Dark Mode System**: Implemented a responsive dark theme system (`prefers-color-scheme: dark`) mapping directly to the desired dark teal/charcoal aesthetic.
- **CSS Variables Refactor**: Extracted color definitions (`--bg`, `--surface`, `--primary`, `--sidebar-bg`) for seamless theme switching.
- **Global Documentation**: Created `docs/` folder containing rules, structure, decisions, and changelogs.

### Changed
- **React Frontend Aesthetic Migration**: Completely migrated the React frontend to match the legacy AppScript UI.
  - Refactored all page components (`Dashboard`, `POS`, `SalesHistory`, `Products`, `Purchases`, `Suppliers`, `Customers`, `Finance`, `CashDrawer`, `Users`, `Settings`, `Login`).
  - Replaced generic CSS with the strict `.panel`, `.view-header`, `.toolbar`, `.pill` structure.
  - Overhauled `index.css` to act as the single source of truth for the system's global design.
- **Button Fixes**: Fixed the global `.btn` class from forcing 100% width to being correctly sized via `inline-flex`, resolving the "unresponsive" and layout-breaking buttons across the platform.

### Fixed
- Fixed broken layout elements on the Dashboard charts by updating grid and flex properties.
- Fixed the Login screen gradient and inputs matching the new Dark Mode variables.
- Resolved a missing font issue by restoring Vite's default `Inter` font via Google Fonts.
