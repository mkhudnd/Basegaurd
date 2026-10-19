# CODEX TASK 01 — Implement the Guard Incident Journey

## Goal

Convert the existing React Native `apps/guard/App.tsx` pilot into a well-structured, usable Android incident prototype faithful to the provided Stitch designs. Keep the real Supabase and encrypted SQLite outbox from the starter; do not treat the browser demo as production implementation.

## Source files to inspect first

- `AGENTS.md`
- `apps/guard/App.tsx`, `apps/guard/src/offline.ts`, `apps/guard/src/api.ts`, `apps/guard/package.json`
- `supabase/schema.sql`, `docs/TEST_PLAN.md`
- `prototype/` (working clickthrough and client-side simulated state transitions)
- Relevant `design/stitch-original/**/code.html` and `design/stitch-additional/**/code.html`, screen PNGs and DESIGN.md

## Acceptance criteria

### A. User and navigation
- [ ] Authenticated guard lands on Today's Duty, which displays verified duty/site or an explicit no-assignment state.
- [ ] Bottom tabs: Today, OB, Incidents, Handover. Handover marked planned; no misleading button.
- [ ] Home's Report Incident action opens the incident form and Back/Cancel works.
- [ ] Form screens handle Android keyboard and safe areas without clipped fields or fixed-height overlap.
- [ ] Navigation survives routine app focus changes; avoid accidental duplicate submissions.

### B. Incident form
- [ ] Fields: category, severity, event time (actual time recorded separately), factual narrative, optional immediate actions.
- [ ] Validate required fields and minimum sensible narrative length before queuing.
- [ ] Allow late-reported incident event time. Don't substitute `Date.now()` for an edited event timestamp; validate reasonable time bounds and server policy.
- [ ] Remove unsupported radio channel, phone numbers, GPS, biometric and AES guarantee claims from UI.
- [ ] For urgent incidents show: 'Use approved emergency telephone/radio procedures. In-app submission does not dispatch assistance.'

### C. Offline outbox
- [ ] Save uses `queueRecord` and returns the real durable local record ID; surface clear storage errors.
- [ ] Submission state immediately displays **Saved Locally / Pending Sync** until actual confirmed receipt.
- [ ] Sync Queue shows queued, sending, failed and received records, with error/retry action.
- [ ] `syncRecords` calls the actual Supabase RPC, uses stable UUID on retries, checks receipt response, and updates record only after confirmation.
- [ ] Failed sync never silently deletes or marks delivered.
- [ ] Do not claim guaranteed background sync or emergency delivery.
- [ ] Existing SQLCipher must be included in Android native binary and tested; Expo Go is insufficient.

### D. History + details
- [ ] Local incident history shows queued/failed/received records with correct labels, saved timestamps, category, severity and narrative preview.
- [ ] Tapping a card opens matching details, not a placeholder `#` link.
- [ ] `serverRef` is displayed only after server receipt; local UUID remains visible earlier.
- [ ] Acknowledgment is displayed only after a **real server state** has been fetched and validated; if not yet wired say 'Acknowledgment unavailable' rather than invent status.

### E. Design quality
- [ ] Forest-green and white Stitch style with Noto Sans or documented platform fallback.
- [ ] 360–412px Android tested; no overlap in badges, headers, save/cancel actions or status banners.
- [ ] Consistent `components/` buttons, cards, chip labels, field inputs, connection indicators.
- [ ] Screens remain usable offline and on low-end devices.

### F. Verification
- [ ] `npm install` completes using fresh package-lock.
- [ ] `npx expo install --check` output reviewed; fix packages via Expo tooling.
- [ ] `npm run typecheck` passes.
- [ ] Automated tests for validation, local ID, sync failure/retry, idempotent receipt mapping and role scoping are present and passing.
- [ ] Conduct physical/emulator Android tests: offline save, app restart, restore internet, manual sync, double-tap save, expired shift, refused authorization.
- [ ] Produce concise test report. Do not claim test results you did not execute.

## Data / schema issue to investigate

`queueRecord()` currently always sets the event timestamp to save time; inspect whether the existing `submit_incident` RPC accepts `p_reported_at` and distinguish event time from reporting time. Implement a backwards-compatible correction carefully, avoiding a live schema change without approval.

## Development hygiene

Keep all generated data fictional. Commit changes in logical increments; avoid broad package upgrades unrelated to the sprint. Stop if you need live Baseguard access, actual site assignments or approvals, and document the blocker.

## Definition of done

The complete incident journey works on an Android development build using a disposable Supabase project with authorized fictional accounts. Any unverified feature is visibly labeled not yet implemented. Provide an Android test checklist and screenshots for the key statuses.
