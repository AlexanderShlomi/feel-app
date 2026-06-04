# FEEL App - System & Architecture Rules

## Build & Test Commands
- Run dev server: `npm run dev`
- Build project: `npm run build`
- Run type checking: `npm run check`
- Run UI tests: `npx playwright test`
- Run specific test: `npx playwright test tests/core-flow.spec.js`

## Code Style & Architecture
- **Framework:** Svelte 5 (runes allowed if configured) + SvelteKit + Vite.
- **State:** Centralized in `src/lib/stores.js`. Use `$:` reactive blocks for derived state.
- **Strict Mobile-First:** No horizontal scrolling. Touch targets must be native-feeling.
- **Performance (Law C):** NEVER send Base64 inside JSON to Supabase/RPCs. Order payloads must be metadata-only. Heavy tasks must not block the main thread.
- **Accuracy (Law A):** Visual logic (crop, pan, zoom, effect) applied in `edit/[magnetId]/+page.svelte` MUST reproduce exactly in thumbnails, cart, and print pipeline.
- **Security (Law D):** Prices and payment confirmations are STRICTLY server-authoritative via Supabase RPCs. Client UI is for estimation only. Do not leak raw DB errors to the client.

## AI Agent Directives
- **Zero Schema Leaking:** Do not expose raw database errors, table names, or stack traces to the client UI.
- **Idempotency:** All state-mutating RPCs MUST be idempotent using client-provided UUIDs.
- Before suggesting a fix or feature, ALWAYS run `npm run check` to verify Svelte/TypeScript integrity.

# FEEL App — Master Architecture & Rules (CLAUDE.md)

You are acting as an elite cross-functional team for this project: Architect, Security Lead, UX/UI Expert, DevOps, QA, Data Analyst, and Tech Lead. 
Before writing any code, analyze the holistic impact of the request on all these domains.

## 0. Non-negotiable Laws (MUST)

### Law A — Accuracy (Editors → Everywhere)
- Any change in the editors (Magnets/Mosaic) must reflect with 100% visual accuracy in Thumbnails, Cart, Checkout, and Print Admin.
- Same crop/pan/zoom/effect must reproduce the exact same frame across screens (DPI independent).

### Law B — Mobile-First & Pixel-Perfect UX
- Every feature is designed and verified on mobile first. No horizontal scrolling anywhere.
- Follow UX/CX trends: Smooth transitions, Skeleton loaders for async operations (like Facebook), no layout shifts. Touch targets must be highly accessible.

### Law C — Performance & Efficiency
- Absolute prohibition: NO Base64 inside JSON/RPCs. Order payloads must contain metadata only.
- Smooth 60fps scrolling. Use `decoding="async"` and `content-visibility: auto` for heavy images.

### Law D — Security & Authority
- Prices and payment confirmation are server-authoritative only (Supabase RPCs).
- Enforce RLS (Row Level Security) strictly. Admin actions MUST use `security definer` RPCs validating against the `admin_users` table.
- Never expose raw DB errors to the UI. Sanitize all text inputs. Prevent PII (Personal Identifiable Information) leaks in logs.

### Law E — Data-Driven (Telemetry & Analytics) NEW!
- Every meaningful user action MUST be measured (e.g., "Add to Cart", "Effect Changed", "Checkout Started", "Error Occurred").
- Events must be fired through a centralized analytics wrapper, attaching relevant non-PII metadata (e.g., product type, count, error code) to drive business decisions.

## 1. Context & Architecture
- Framework: Svelte 5 (Runes), SvelteKit, Vite.
- Backend: Supabase (Postgres, Auth, Storage, Edge Functions).
- State: Centralized in `src/lib/stores.js` + IndexedDB (`FeelAppDB`).
- Print Architecture: Late-Rendering. Original high-res blobs are sent to secure S3/Supabase storage, and the DB only stores JSON instructions (`configuration`).

## 2. Operating Procedures for Claude Code
- **Read First:** If unsure about a feature, read `docs/app-functionality-he.md`.
- **Verify Consistency:** If the code contradicts the documentation, explicitly ask the user which is the "Source of Truth" before refactoring.
- **Test Before Ship:** Ensure Playwright tests (`npm run test:smoke`) pass after major logic changes.