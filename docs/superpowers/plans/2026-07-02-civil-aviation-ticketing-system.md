# Civil Aviation Ticketing System Implementation Plan

> **For agentic workers:** This plan has been completed. Keep the checked task list below as the implementation record.

**Goal:** Build a new civil aviation ticket sales and reservation training system from the provided requirements, then package it as a Windows desktop application.

**Architecture:** A React/Vite front end calls a local Express API. The same API can run in browser/web mode for classroom B/S use and inside Electron for desktop use. Seed data is code-owned, while generated orders are persisted to a local JSON database file so the desktop build has no external MySQL/Tomcat dependency.

**Tech Stack:** TypeScript, React, Vite, Express, Vitest, Electron, electron-builder, JSON file persistence.

**Final status as of 2026-07-03:** Completed. The new system lives in `civil-aviation-ticketing/`, passes tests/typecheck/build/production audit, and has Windows x64/arm64 portable exe outputs under `civil-aviation-ticketing/release/`.

---

## File structure

- `civil-aviation-ticketing/package.json` - scripts, dependencies, Electron packaging config.
- `civil-aviation-ticketing/src/domain/types.ts` - shared domain contracts.
- `civil-aviation-ticketing/src/domain/validation.ts` - passenger, contact, search, cabin, order validation.
- `civil-aviation-ticketing/src/domain/pricing.ts` - fare, refund and passenger price calculation.
- `civil-aviation-ticketing/src/domain/ticketing.ts` - PNR, order number, ticket number, itinerary helpers.
- `civil-aviation-ticketing/src/data/cities.ts` - 50+ Chinese cities with city code, province and airport.
- `civil-aviation-ticketing/src/data/flights.ts` - deterministic teaching flight data with normal, low fare and sold-out cases.
- `civil-aviation-ticketing/src/data/rules.ts` - baggage, refund, change and special passenger rules.
- `civil-aviation-ticketing/server/server.ts` - Express API entry and route handlers.
- `civil-aviation-ticketing/server/orderStore.ts` - JSON file order persistence.
- `civil-aviation-ticketing/electron/main.ts` - desktop main process, local API startup, window loading.
- `civil-aviation-ticketing/src/App.tsx` - user-facing workflow: query, flight list, booking form, confirmation, orders, rules.
- `civil-aviation-ticketing/src/styles.css` - aviation blue/orange responsive visual system.
- `civil-aviation-ticketing/tests/domain.test.ts` - TDD coverage for the core rules.
- `civil-aviation-ticketing/docs/*.md` - delivery docs, acceptance checklist, database design and manuals.
- `civil-aviation-ticketing/docs/reviews/*.md` - review reports after implementation.

## Task 1: Project skeleton

**Files:**
- Create `civil-aviation-ticketing/package.json`
- Create `civil-aviation-ticketing/tsconfig.json`
- Create `civil-aviation-ticketing/tsconfig.node.json`
- Create `civil-aviation-ticketing/vite.config.ts`
- Create `civil-aviation-ticketing/index.html`

- [x] Create the Vite/Electron package with scripts: `dev`, `server:dev`, `build`, `test`, `electron:build`, `dist:win`.
- [x] Install dependencies with `npm install`.
- [x] Run `npm test` and expect Vitest to start once tests exist.

## Task 2: Domain TDD slice

**Files:**
- Create `tests/domain.test.ts`
- Create `src/domain/types.ts`
- Create `src/domain/validation.ts`
- Create `src/domain/pricing.ts`
- Create `src/domain/ticketing.ts`

- [x] Write tests that verify: departure and arrival city cannot match; adult is 18-70; child is 2-12 and must link an adult; infant is 14 days-2 years and must link an adult; UM is 5-12 and requires sender/receiver; cabin inventory cannot be exceeded; order creation produces order number, PNR and ticket numbers; refund fee follows the requirement table.
- [x] Run `npm test` and confirm these tests fail before implementation.
- [x] Implement the smallest domain code that makes these tests pass.
- [x] Run `npm test` and confirm all tests pass.

## Task 3: Seed data and API slice

**Files:**
- Create `src/data/cities.ts`
- Create `src/data/flights.ts`
- Create `src/data/rules.ts`
- Create `server/orderStore.ts`
- Create `server/server.ts`

- [x] Add at least 50 city records, including province, city code and airport.
- [x] Add API endpoints: `GET /api/cities`, `GET /api/flights`, `GET /api/rules`, `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/cancel`, `POST /api/orders/:id/refund`, `POST /api/orders/:id/change`.
- [x] Validate all API inputs with the same domain validation used by tests.
- [x] Persist generated orders to a JSON file under `.local-data/orders.json` in development and Electron `userData` in desktop mode.
- [x] Run `npm test` and `npm run build`.

## Task 4: Frontend booking workflow slice

**Files:**
- Create `src/main.tsx`
- Create `src/App.tsx`
- Create `src/styles.css`
- Create `src/vite-env.d.ts`

- [x] Implement homepage search with city search/select, date picker, adult/child/infant counts and validation.
- [x] Implement flight result cards with airline logo initials, airports, time, duration, aircraft, load/remaining seats, cabin choices and sorting by departure time, price and duration.
- [x] Implement booking form for adult, child, infant and UM fields with real-time errors.
- [x] Implement confirmation panel with flight, passengers, fare breakdown and rules summary.
- [x] Implement order success with PNR, ticket numbers, electronic ticket and itinerary print/PDF simulation.
- [x] Run `npm run build` and manually smoke the flow in a browser.

## Task 5: Orders, rules, desktop and docs slice

**Files:**
- Create `electron/main.ts`
- Create `docs/requirements.md`
- Create `docs/database-design.md`
- Create `docs/student-guide.md`
- Create `docs/teacher-admin-guide.md`
- Create `docs/acceptance-checklist.md`
- Create `docs/reviews/*.md`

- [x] Implement order list/detail, cancel, refund and change simulation in the UI.
- [x] Implement rule center for baggage, refund, change and special passenger rules.
- [x] Configure Electron main process to start the local API and load the built UI.
- [x] Run `npm test`, `npm run build` and `npm run dist:win`.
- [x] Review the completed system against the requirement checklist using separate review reports for requirements coverage, UI/UX, data/security and desktop packaging.

## Self-review checklist

- [x] P0: homepage query, flight list, adult booking and order confirmation are implemented.
- [x] P1: child/infant booking, baggage/refund rules and electronic ticket are implemented.
- [x] P2: UM booking, order management, cancel/change/refund simulation are implemented.
- [x] 50+ city data exists.
- [x] Windows desktop packaging is configured and attempted.
- [x] Delivery docs and review reports exist.
