# Architecture Decision Records (ADR)

## 1. Decoupling from Google Apps Script
**Context**: The original system ran entirely on Google Apps Script (backend) and Sheets (database) with a single monolithic `Index.html` file.
**Decision**: We transitioned to a Node.js API backend and a Vite + React frontend.
**Reasoning**: Better performance, proper standard API routing, enhanced developer experience (HMR via Vite), and real relational database compatibility.

## 2. Maintaining the AppScript Aesthetic via Global CSS Reset
**Context**: Moving to React often tempts developers into adopting CSS frameworks (like Tailwind or Material UI), which would deviate from the highly praised custom AppScript design.
**Decision**: We ported the original `Index.html` CSS directly into `frontend/src/index.css`.
**Reasoning**: This guarantees 100% visual parity. Page components were refactored to use standard semantic class names (`.panel`, `.view-header`, `.pill`) rather than bringing in an external library.

## 3. Dark Mode Implementation
**Context**: The user requested a dark theme matching a specific provided mock-up.
**Decision**: Implemented using native CSS media queries (`@media (prefers-color-scheme: dark)`) and CSS custom properties (`var(--bg)`, `var(--surface)`).
**Reasoning**: Allows the application to dynamically adapt to the user's OS-level preferences without requiring a complex JavaScript context toggler.

## 4. API Client Standardization
**Context**: Replaced `google.script.run` RPC calls with standard HTTP requests.
**Decision**: Integrated Axios (`frontend/src/api/client.js`) with configured interceptors for JWT token attachment and automatic refreshing.
**Reasoning**: Provides a resilient, standard approach to authentication that handles expired tokens gracefully (redirecting to `/login` if refresh fails). A strict 30-second timeout was added to fail-fast if the backend becomes unresponsive.
