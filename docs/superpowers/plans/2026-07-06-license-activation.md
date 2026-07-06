# ToB License Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build online-once invitation activation with device-bound signed offline licenses for the Electron ticketing app.

**Architecture:** Add a focused `server/license/` module for cryptographic licensing, local Express license APIs, a React license gate, and deployable admin/server scripts. The app verifies signed license files locally and only calls a configurable remote activation service for first activation or opportunistic checks.

**Tech Stack:** Node 20 `crypto` Ed25519, Express, React/Vite/TypeScript, Vitest, Electron/electron-builder.

---

### Task 1: License Core

**Files:**
- Create: `civil-aviation-ticketing/server/license/canonical.ts`
- Create: `civil-aviation-ticketing/server/license/types.ts`
- Create: `civil-aviation-ticketing/server/license/crypto.ts`
- Create: `civil-aviation-ticketing/server/license/device.ts`
- Create: `civil-aviation-ticketing/server/license/store.ts`
- Test: `civil-aviation-ticketing/tests/license-core.test.ts`

- [ ] Write failing tests for signed license verification, tamper rejection, expiry rejection, and device mismatch.
- [ ] Implement stable canonical JSON serialization.
- [ ] Implement Ed25519 sign/verify helpers that accept PEM keys.
- [ ] Implement device fingerprint helper returning SHA-256 hashes and short display code.
- [ ] Implement license file read/write/status helper with atomic write.
- [ ] Run `npm test -- tests/license-core.test.ts` and commit.

### Task 2: Activation Service Protocol and Scripts

**Files:**
- Create: `civil-aviation-ticketing/server/license/activationClient.ts`
- Create: `civil-aviation-ticketing/server/license/issuer.ts`
- Create: `civil-aviation-ticketing/scripts/license-admin.ts`
- Create: `civil-aviation-ticketing/scripts/license-server.ts`
- Test: `civil-aviation-ticketing/tests/license-server.test.ts`

- [ ] Write failing tests for invite activation, same-device idempotency, device limit rejection, and revoked invite rejection.
- [ ] Implement issuer functions that operate on a JSON invite database and sign license envelopes.
- [ ] Implement activation client with timeout and structured errors.
- [ ] Implement admin CLI for key generation, invite creation/list/revoke.
- [ ] Implement HTTP license server endpoints `/health`, `/v1/activate`, `/v1/check`.
- [ ] Run `npm test -- tests/license-server.test.ts` and commit.

### Task 3: Local App API Enforcement

**Files:**
- Modify: `civil-aviation-ticketing/server/server.ts`
- Modify: `civil-aviation-ticketing/server/orderStore.ts` if shared path helper is needed
- Test: `civil-aviation-ticketing/tests/license-api.test.ts`

- [ ] Write failing tests proving business APIs are blocked without a valid license while `/api/license/status` remains accessible.
- [ ] Add `LicenseManager` integration in Express app.
- [ ] Add `/api/license/status`, `/api/license/activate`, `/api/license/offline-import`.
- [ ] Add middleware that protects `/api/cities`, `/api/flights`, `/api/orders`, `/api/rules` unless licensed.
- [ ] Run `npm test -- tests/license-api.test.ts` and commit.

### Task 4: React License Gate

**Files:**
- Modify: `civil-aviation-ticketing/src/App.tsx`
- Modify: `civil-aviation-ticketing/src/styles.css`
- Optional Create: `civil-aviation-ticketing/src/licenseTypes.ts`

- [ ] Add TypeScript types for license status/activation responses.
- [ ] Add a license gate that loads status before business data.
- [ ] Show activation form with invite code, device display code, customer/license summary, error states, and loading state.
- [ ] Ensure original business UI only renders after `licensed === true`.
- [ ] Run `npm run typecheck` and commit.

### Task 5: Version, Docs, Packaging

**Files:**
- Modify: `civil-aviation-ticketing/package.json`
- Modify: `civil-aviation-ticketing/package-lock.json`
- Modify: `.gitignore`
- Modify: `AGENTS.md`, `README.md`, `civil-aviation-ticketing/README.md`, `civil-aviation-ticketing/docs/*.md`, review docs

- [ ] After feature behavior is verified, set package version to `1.1.0`.
- [ ] Update docs for activation flow, env vars, local license server, and 1.1.0 deliverables.
- [ ] Update `.gitignore` to keep only 1.1.0 installers.
- [ ] Run full verification and build x64/arm64 installers.
- [ ] Commit and push.

### Task 6: Multi-agent Review

**Files:**
- No direct ownership; reviewers inspect all changes from base SHA to head SHA.

- [ ] Dispatch security reviewer focused on license bypass, private key handling, signature verification, and offline behavior.
- [ ] Dispatch product/spec reviewer focused on ToB activation UX and requirement coverage.
- [ ] Dispatch code quality reviewer focused on maintainability and test coverage.
- [ ] Fix all Critical/Important findings.
- [ ] Re-run full verification and push final commit.
