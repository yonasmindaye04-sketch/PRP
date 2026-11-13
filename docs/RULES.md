# System Rules & Guidelines

## 1. UI / UX Aesthetic Parity (The "AppScript" Aesthetic)
- **Dark Mode by Default**: The system employs a premium dark mode based on the user's system preferences, utilizing variables like `--bg` (`#0A110F`) and `--surface` (`#141C1A`).
- **Semantic Components**:
  - Use `.panel` instead of generic `.card` classes for primary containers.
  - Use `.view` and `.view-header` to standardize page layouts.
  - Use `.pill` for badges (with variants `.pill.ok`, `.pill.low`, `.pill.bad`).
  - Use `.field` and `.field-grid` for responsive form layouts.
- **Button Standards**:
  - Buttons (`.btn`) should be inline by default (`width: auto` or `inline-flex`) to avoid breaking responsive layouts.
  - Use full-width buttons (`width: 100%`) ONLY in specific constrained contexts like Login or Modals.

## 2. Code Structure
- **React Components**: Group shared layout components in `components/Common.jsx` and `Layout.jsx`. Page-specific views reside in the `pages/` directory.
- **CSS Isolation**: Rely on CSS variables defined in `index.css` to maintain strict UI parity. Avoid adding inline styles unless necessary for dynamic calculations.

## 3. Backend & API Rules
- All requests must go through the centralized Axios client (`api/client.js`).
- The Axios client uses a 30-second timeout. Ensure the backend (Node.js) is properly running on the configured port (default `3000`) before interacting with the frontend to prevent connection timeouts.
- **Authentication**: JWT access and refresh tokens must be attached via interceptors automatically. Missing or expired tokens redirect strictly to `/login`.

## 4. State Management
- Use `AuthContext.jsx` for global user and permissions state.
- Keep page-level data fetching scoped strictly to `useEffect` hooks within their respective page components.
