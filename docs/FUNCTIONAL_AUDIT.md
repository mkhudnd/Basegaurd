# Functional audit — 19 October 2026

**Integration update:** This is the pre-Gemini audit snapshot. The guard now also reads permitted server incident history and supervisor updates for incident details. See [GEMINI_INTEGRATION_REPORT.md](GEMINI_INTEGRATION_REPORT.md) for the current integration state and verification limits.

This is a source audit of a proposed industrial-attachment pilot, not deployment acceptance. The SRS is a draft; company approval and procedures take precedence. **Implemented** means a code path exists, not that a device or database integration test passed. The browser prototype is simulated throughout.

## Evidence and trust boundary

- Runtime: `apps/guard/App.tsx`, `apps/guard/src/{api,offline,guard-service,incident-domain,sync-engine}.ts`, `apps/supervisor/src/{main,service}.tsx`, `supabase/schema.sql`.
- Requirements: `docs/SRS-v0.1.pdf`, `docs/CODEX_TASK_01.md`, `docs/TEST_PLAN.md`, `docs/ANDROID_INCIDENT_TEST_REPORT.md`, `README.md`, `AGENTS.md`.
- UX reference: `prototype/` with browser `localStorage` and simulated transitions. Stitch `code.html`, `screen.png`, and `DESIGN.md` are visual references only; scripts and operational claims are not runtime evidence.
- Tests: native domain/sync tests in `apps/guard/src/incident-domain.test.mjs`; browser simulation tests in `tests/prototype.test.mjs`.

## Functional inventory

| Area / SRS IDs | State | Actual behavior and gap |
|---|---|---|
| Individual auth/session (FR-01, NFR-03) | Implemented, unverified on device | Both apps use Supabase password auth. Guard sessions use SecureStore; web uses Supabase browser persistence. No app lock, offline re-verification policy, or revocation test. No demo bypass in deployable apps. |
| Roles/site authorization (FR-02, FR-03, FR-23) | Implemented in staged SQL; integration unverified | RLS uses `auth.uid()` and private role/assignment helper. RPCs recheck site and shift at send time. Supervisor UI checks profile role, but server RLS/RPC is authoritative. SQL has **not** been applied or tested here. |
| Site assignment/duty (FR-05) | Partial | Guard loads most recent active, time-valid shift and site; 12-hour cached duty permits offline local entry. UI labels cached duty. No shift choice, explicit confirmation, or company-approved cache-expiry policy. Server may reject a revoked/expired assignment at sync. |
| Digital OB (FR-06–08) | Partial | Guard creates a categorized local OB and syncs through `submit_ob_entry`. Local history is limited to 100 rows. OB event time is phone save time; no editable event time, server history search, or correction UI/RPC. SQL has an amendment table but no authoring flow. Supervisor lists up to 200 recent entries and filters the loaded window by date. |
| Incident create/history/detail (FR-09, FR-10, FR-13) | Implemented code path, unverified integration | Form validates category, severity, narrative, shift and edited event time; encrypted local save returns UUID. Queue/history/details reflect local records. Server RPC generates stable public number and receipt. Immediate actions are appended to description. History is device-local, not complete server history. Emergency reminder remains visible. |
| Incident follow-up (FR-11–12) | Partial | Supervisor can acknowledge via RPC; server appends update/audit row. Guard detail deliberately says acknowledgement unavailable because it does not fetch server follow-up. Progress, resolution, close, note history and dedicated review screen are missing. |
| Offline queue/retry/receipt (FR-18–22) | Implemented code path, unverified on device/DB | SQLCipher-configured SQLite + SecureStore key, UUID outbox, queued/sending/failed/received, manual and foreground retry, RPC receipt validation. Failed rows are retained. No guaranteed background delivery, network-change listener, or physical SQLCipher persistence evidence. Expo Go cannot validate this path. |
| Shift handover (FR-14–15) | Deferred Sprint 2 | Schema table and Stitch/prototype interactions exist; deployable guard app has a labeled placeholder. No submission or acceptance RPC. |
| Supervisor incident management/inbox (FR-16) | Partial | Assigned-site table, latest 100, acknowledge action. One site at a time; no combined permitted-sites inbox, case detail, progress/closure, or updates timeline. Figures count only loaded rows. |
| Site/staff administration (FR-04) | Missing | Tables support profiles/sites/assignments, but no admin UI or vetted provision/revoke RPCs. Controlled administrator SQL is stated as pilot setup; provisioning audit is not implemented. |
| PDF reports/audit (FR-17, FR-24–25) | Partial | Browser Print / Save PDF prints currently loaded OB table filtered by site/date. It is not a dedicated PDF generator, omits corrections, and is capped at 200 loaded rows. SQL logs incident/OB submission and acknowledgement; direct audit review is unavailable and admin lifecycle audit is missing. |

## Defects reconciled in this checkpoint

1. Guard sign-out previously deleted **all users'** local records before knowing whether Supabase sign-out succeeded. It now signs out first and removes only the current guard's **received** rows and cached duty. Unsent rows always remain, including other users' rows.
2. Duty lookup and incident validation/save no longer live inside the report form layout. A failed duty refresh exposes cached versus server duty clearly. A local save followed by a history-read failure still opens Submission Status with the durable local UUID and no false receipt.
3. Supervisor read and acknowledgement calls are in a typed service. An acknowledgement response must contain the requested ID and a plausible server state before the UI treats it as successful.

## Still open before pilot

- Run Android native development-build tests at 360/393/412 px, including app restart, SQLCipher at rest, keyboard, concurrent save, expired duty, sign-out and retry. No such device test is claimed here.
- Run isolated Supabase integration tests with fictional accounts for RLS cross-site denial, RPC idempotency, conflict detection, revocation, and acknowledgement. The SQL remains unapplied.
- Resolve approved BYOD, retention, local wipe, offline duty cache, incident escalation and company operating policies.
- Implement Sprint 2 only after scope approval: OB corrections, handovers, complete follow-up, administration, full dated export/audit.

## Verification at this checkpoint

| Command | Actual result |
|---|---|
| Guard `npm run typecheck` | Passed. |
| Guard `npm test` with bundled Node 24 | 9 passed, 0 failed. A module-type performance warning remains. |
| Guard `npx expo install --check` | Exit 0, “Dependencies are up to date” using the local Expo version map; CLI said network validation was unavailable/unreliable in offline mode. React Native was corrected from 0.81.4 to 0.81.5 with `npx expo install`. |
| Supervisor `npm run typecheck` and `npm run build` | Passed; Vite built 100 modules. |
| `node --test tests/prototype.test.mjs` | 4 passed, 0 failed; tests cover simulation only. |
| `node scripts/static-check.mjs` | Passed: 11 RLS-enabled table declarations, three RPC declarations/grants and selected source assertions. This is not a database security test. |
| Native Android, SQLCipher persistence, Supabase RLS/RPC, browser print | Not run; no Android target or isolated Supabase project was used. |

`npm install` reported 35 package advisories (12 moderate, 23 high) for the guard dependency tree. They have not been triaged in this functionality checkpoint; do not treat a passing typecheck as a dependency security review. The earlier `ANDROID_INCIDENT_TEST_REPORT.md` records a previous environment and should not be read as the result of this run.

## Scope deviations from draft SRS

The current sprint deliberately prioritizes the guard incident journey. Draft SRS requirements for handover, OB corrections, full supervisor lifecycle, admin provisioning, and complete PDF/audit export remain unfulfilled. No earlier school SRS document was edited.
