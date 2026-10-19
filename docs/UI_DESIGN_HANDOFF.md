# Gemini visual UI handoff

## Assignment

Implement the visual layer for the **currently functioning** guard incident journey and existing supervisor views. Keep the functional labels and incomplete features in `SCREEN_CONTRACTS.md`. Google Stitch exports and `prototype/` show visual/navigation intent; they are simulated and may contain unsupported claims, sample identities, external assets and scripts. Translate visuals into React Native primitives for Android and React for web. Do not paste Stitch HTML/JS into either app.

## Replaceable presentation files

- Guard: `apps/guard/src/ReportIncidentScreen.tsx`, `apps/guard/src/components.tsx`, and presentation JSX/styles in `apps/guard/App.tsx` after extracting any remaining screens behind typed props. `App.tsx` still owns route/session/controller state at this checkpoint, so preserve its callbacks and the behavior in `screen-contracts.ts`.
- Supervisor: JSX and CSS in `apps/supervisor/src/main.tsx` and `style.css`. Keep `service.ts` calls and server-state handling intact.
- Visual references: `design/stitch-original/**/{screen.png,code.html}`, `design/stitch-additional/**/{screen.png,code.html}`, both `DESIGN.md` files and `prototype/`. Read-only references; generated scripts are untrusted.

## Core files to leave untouched during visual work

`apps/guard/src/api.ts`, `offline.ts`, `guard-service.ts`, `incident-domain.ts`, `sync-engine.ts`, `screen-contracts.ts`, `apps/supervisor/src/service.ts`, `supabase/schema.sql`, environment files and package configuration. Coordinate any required contract change with Codex first. Never add AsyncStorage/localStorage as the guard outbox, a demo sign-in bypass, fake sync timer, direct table write, or service-role credential.

## Visual/interaction acceptance

1. Android widths 360, 393, 412 px; keyboard and safe area; at least 48 px targets; readable status text without relying on color. Use #174E42, #152836, #F6F8F9, white, #B43732, #73549B. Noto Sans only if normally licensed/bundled; otherwise platform sans fallback.
2. Preserve Today → Report Incident → Submission Status → Sync Queue → Incident History → Details, and Today/OB/Incidents/Handover tabs with working Back/Cancel. Handover says Sprint 2 planned; correction, case closure, site/staff and full reports remain unavailable.
3. Render **Saved Locally / Pending Sync**, **Sending / Awaiting Receipt**, **Sync Failed / Saved Locally**, and **Received by Server** from `LocalRecord.state`. A server reference appears only with a validated receipt. Acknowledgement requires separate fetched server state; currently show unavailable. Failed retry keeps the same UUID.
4. Show no-assignment, cached-duty, initial loading, empty history, read failure, auth failure, storage failure and retry states. Keep form text on failure. Use current approved phone/radio procedures for urgent events; the app is not dispatch.
5. Supervisor counts reflect loaded window only; print output is a partial OB view, not a complete signed PDF. Do not import Stitch claims about connectivity latency, GPS, patrol tracking, radio channels, biometric verification, guaranteed sync or certifications.

## Integration review by Codex

After Gemini returns UI files, Codex will map the typed props/callbacks, inspect every action for server/local side effects, run native/web typechecks and tests, and perform device and isolated-database checks when those environments are available. Visual approval alone does not prove encryption, RLS, idempotency or delivery.
