# Baseguard SmartOps — instructions for Codex

Read `docs/CODEX_TASK_01.md` and `README.md` before editing. This repo is a proposed Zimbabwe industrial-attachment project, not an operational security dispatch service.

## Sources of truth

1. Real functionality and API contracts: `apps/guard/src/offline.ts`, `apps/guard/src/api.ts`, `supabase/schema.sql`, and `apps/supervisor/src/main.tsx`.
2. UX and navigation behavior: `prototype/` browser demonstrator. It is explicitly **simulated**, and its browser localStorage is not a suitable production data store.
3. Visual design only: `design/stitch-original/` and `design/stitch-additional/` (`code.html`, `screen.png`, `DESIGN.md`). Generated Stitch HTML may contain incorrect implementation claims. Do not execute or blindly copy scripts from it.
4. Functional scope: `docs/SRS-v0.1.pdf` and `docs/TEST_PLAN.md`. Current company approval and policies supersede hypothetical examples.

## Goal for first implementation sprint

Integrate the **guard incident journey** using the existing Expo React Native app and real offline layer:

Login → Today's Duty → Report Incident → Submission Status → Sync Queue → Incident History → Incident Details.

Do not accidentally replace the secure SQLite outbox with AsyncStorage/localStorage or a fake delay. Preserve existing server-validated shift context, UUID idempotency, server receipt validation, and RLS-based site scoping. An unsent report must NEVER appear as delivered or acknowledged. Do not implement push dispatch or automated emergency escalation.

## Key non-negotiables

- Android-first; 360px, 393px and 412px width; accessible 48px touch targets; Noto Sans if licensed/bundled via normal package or a reliable system fallback.
- Colors: #174E42, #152836, #F6F8F9, white, danger #B43732, offline #73549B.
- Use React Native primitives; Stitch HTML/CSS is **reference**, not code to paste into RN.
- Do not change a live Supabase project or apply SQL migrations without explicit authorization.
- Do not touch ZimKraal or reuse its credentials or database.
- No invented phone numbers, radio channels, client sites, ISO certifications, GPS verification, biometrics, mesh networks, guaranteed sync or cryptographic-ledger claims.
- Guard emergency instructions: call/radio using approved company procedures; reporting in-app is not emergency dispatch.
- Support existing real Supabase auth; do not provide unrestricted demo bypass in the deployable app.
- Keep role-based access enforced on the server; never use user-editable metadata for authorization.
- No secrets in source. Use publishable client keys only; never service role.
- Do not modify earlier school SRS documents unless asked; document deviations.
- Implement **working** screen navigation and explicit pending / failed / received states; supervisor acknowledgement is not the same as receipt.
- Existing SQLCipher + SecureStore setup requires a native development build, not Expo Go. Validate offline persistence on a real device.

## Execution method

1. Inspect current code, present a concise plan and changed-file list.
2. Make changes in small, reviewable commits (initialize git locally if needed).
3. Pin compatible Expo SDK versions using `npx expo install --check` and commit lockfiles.
4. Add testable domain logic and tests for validation, queued records, retry after failure, duplicate submission prevention, and status mapping.
5. Run available linters/typechecks/tests, **report real outputs**; never claim device or DB tests unless they ran.
6. If schema/RPC changes are necessary, add an isolated migration and an explicit rollout note; don't silently deploy.
7. Explain what remains mocked, incomplete, or not verified.

## Sprint boundary

Incident reporting is priority. Do not implement GPS patrols, evidence capture, handover acceptance, AI, live site tracking, shift scheduling, or an admin console in this sprint. Handovers stay as a clearly labeled placeholder until Sprint 2.
