# CODEX TASK — Adopt Gemini SmartOps UI as-is, wire it to real application functionality

## Objective

Use the exact Gemini-generated React Native UI source as the authoritative **visual and component-level implementation** for the seven guard incident-journey screens. Connect it to the **already reconciled** Baseguard SmartOps services and navigation. This is an integration assignment, **not a redesign** or app rewrite.

The nine Gemini files are staged at `handoff/gemini-ui/apps/guard/src/` (seven screens, shared `components.tsx`, and screen barrel). Original Gemini response is in `handoff/GEMINI_ORIGINAL_OUTPUT.txt` as a fallback reference. **Do not run blind copy commands that overwrite production source files.** Begin with comparison and integration on a new Git branch.

## FIRST — Inspect the actual current repo before writing

Read `AGENTS.md`, `docs/FUNCTIONAL_AUDIT.md`, `docs/SCREEN_CONTRACTS.md`, `docs/NAVIGATION_MAP.md`, `docs/UI_DESIGN_HANDOFF.md`, `docs/TEST_PLAN.md`, `apps/guard/App.tsx`, `apps/guard/src/screen-contracts.ts`, `apps/guard/src/components.tsx`, `apps/guard/src/ReportIncidentScreen.tsx`, `apps/guard/src/guard-service.ts` if present, `apps/guard/src/offline.ts`, `apps/guard/src/api.ts`, `apps/guard/src/sync-engine.ts`, `apps/guard/src/incident-domain.ts`, and `supabase/schema.sql`.

Compare each staged Gemini screen with its existing contract, noting exact prop and callback mismatches. Preserve the accepted data and navigation contracts as authoritative. If one staged prop is incompatible, write a small **typed adapter in the app/container layer** or a minimal alias in the view signature; do not rewrite the business logic or visually redesign the screen.

## SECOND — Install the Gemini UI exactly as the visual baseline

Integrate these staged files into the corresponding app locations:

- `apps/guard/src/components.tsx` — shared UI primitives/theme
- `apps/guard/src/screens/LoginScreen.tsx`
- `apps/guard/src/screens/TodaysDutyScreen.tsx`
- `apps/guard/src/ReportIncidentScreen.tsx`
- `apps/guard/src/screens/SubmissionStatusScreen.tsx`
- `apps/guard/src/screens/SyncQueueScreen.tsx`
- `apps/guard/src/screens/IncidentHistoryScreen.tsx`
- `apps/guard/src/screens/IncidentDetailsScreen.tsx`
- `apps/guard/src/screens/index.ts`

Preserve Gemini's layout, user-facing wording (unless misleading), section hierarchy, green/white colors, typography, status chips, card sizes and spacing. **Avoid a new design pass, alternate theme, or building new replacement screens.** Fix only layout defects, non-native/unsupported APIs, accessibility issues, missing font assets, incorrect types/imports and design-to-contract mapping required for a functional Android app. Ensure 360/393/412 px widths, system font scaling, safe areas, and keyboard behavior. The font family keys shown in Gemini's components require correctly loaded Noto Sans assets; otherwise use a verified fallback and report that deviation. Keep icon choices visually consistent and ensure no unsupported claims.

## THIRD — Wire every action to the current real system

- Authentication via existing Supabase Auth, no bypass.
- Today's Duty from authorized site / active-shift data; no fabricated assignments.
- Report Incident validates categories, severity and editable event timestamp; uses current service, local encrypted SQLite outbox and existing double-submit protection.
- Submission Status uses *actual local save status* or *confirmed server receipt*, never fake success.
- Sync Queue uses actual `syncRecords`/existing API, manual retry, stable UUID and real error states; no simulated setTimeout success.
- Incident History reads real local + permitted server data; accurate labels/refs.
- Incident Details reads the selected real report and server-confirmed supervisor status only; unsynced reports cannot show invented server refs.
- `Today | OB | Incidents | Handover` tabs remain consistent with the navigation map. Handover stays the explicitly non-interactive Sprint 2 placeholder; no fake handover or closure flows.
- Screens and bottom navigation correctly route and return/back behavior must be tested; no inert visible controls.
- For emergencies keep company-approved telephone/radio procedures explicit. In-app saving must never claim to dispatch help.

The UI must not directly call Supabase or SQLite: bind it via typed props/actions/controllers from the existing service layer. Do not change RLS policies or production database. Do not use ZimKraal data or credentials. Retain `useSQLCipher` and all existing static-check invariants.

## FOURTH — Verify before handoff

1. Work on a new branch, capture before/after file list and keep commits reviewable.
2. `npm install` only if required; avoid dependency upgrades unless needed for build/compatibility.
3. Run guard TypeScript checks, unit tests, static-check, Expo dependency compatibility checks; also supervisor checks to catch regressions. Report exact outputs.
4. Build and run native Android app on an emulator/device when available; Expo Go is insufficient for SQLCipher.
5. Check login → duty → incident → status → sync queue → history → details, online and offline, app restart, failed retry, duplicate tap, and cross-site denial. Mark unavailable tests as **not run**.
6. Make a screenshot comparison against Stitch for mobile widths to ensure the Gemini UI survives integration.
7. Do not mark the task completed if TypeScript is broken or app flow cannot navigate; list precise blockers instead.

## Final response

List all files added/modified, which Gemini components were adopted unchanged or minimally adapted, how UI props map to functional services, tests passed/failed/not run, screenshots if available, and exact instructions to run the Android prototype.

**Start now by inspecting and comparing the nine staged Gemini UI files with current source/contract files.**
