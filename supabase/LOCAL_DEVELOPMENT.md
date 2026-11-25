# Local development

## Local environment
- Supabase CLI: 3.4.0
- Docker Desktop with WSL2
- API: http://127.0.0.1:54321
- Studio: http://127.0.0.1:54323
- Mailpit: http://127.0.0.1:54324
- Supervisor web: http://127.0.0.1:5180

## Sprint 3.5 validation baseline
- 52 previously reported automated tests passed.
- 34 manual integration checks completed.
- All 12 public tables have RLS enabled.
- All seven migrations replay successfully.
- No security warnings reported by local advisors.
- Three performance warnings remain.
- Three function bodies match after whitespace normalization.
- Hosted database remains unchanged.

## Local test accounts
- supervisor@baseguard.test
- guard1@baseguard.test
- guard2@baseguard.test
- guard3@baseguard.test (invited)

Create the initial three accounts through local Supabase Auth.
Use locally chosen test passwords. Never commit credentials.

## Test sites
- TEST-AVO: Avondale Test Site
- TEST-BOR: Borrowdale Test Site

Assign the supervisor and Guard One to Avondale.
Assign Guard Two to Borrowdale.
Invite Guard Three through the supervisor application.

## Known limitations
- Incident closure frontend action requires integration.
- Historical personnel access requires privacy review.
- RLS performance optimizations remain outstanding.
- Schema diff engines report whitespace-only function body
  differences; complete metadata equivalence is not yet proven.
- General-purpose test-data provisioning remains outstanding. The Sprint 4
  API suite provisions its own isolated geography fixtures.
- Physical mobile integration remains outstanding.
- Hosted schema reconciliation is required before deployment.

## Safety
Do not push migrations to the hosted database without
an approved rollout, reconciliation and backup.

## Sprint 4 geographic workspace

Read [the geographic database contract](GEOGRAPHY_4B.md) for the seven RPCs,
authorization, PostGIS validation and disposable replay instructions. The
forward migration is `20261125110447_sprint_4b_site_geography.sql`. Replay it
with all earlier migrations in a disposable local container before using the
CLI's incremental local `migration up` against an existing stack. Preserve local
accounts and operational records and compare counts and fingerprints before and
after. Confirm the local connection target and migration history. Re-run local
advisors and compare results with the documented baseline.

With the existing local Supabase stack running, point
`apps/supervisor/.env.local` to `http://127.0.0.1:54321` and use its publishable
key. From the repository root run:

```powershell
node supabase/tests/phase_4d_local_api.mjs
npm.cmd --prefix apps/supervisor run dev -- --host 127.0.0.1 --port 5180 --strictPort
```

The API test uses actual local Auth and PostgREST. The local database container
provisions isolated fictional identities and fixtures. Operations under test use
the session tokens returned by Auth. The default test run cleans up its own
fixtures. Pass `--keep-for-browser` to retain marked `QA4D-*` records and
assign the test supervisor to those sites for a browser review. Sign in manually
with the local test supervisor, then verify map visibility and navigation,
center and perimeter reload, and concurrent edits from two tabs. A stale save
should keep the unsaved input visible. The production app has no test sign-in bypass.

See [the map contract](../apps/supervisor/OPERATIONS_MAP.md) for provider
configuration, layer behavior and viewport treatment. Local API tests and
browser verification are separate from unit tests and prototype simulations.

Local server blockers protect active and scheduled shifts and unresolved
incidents. They cannot account for reports, occurrence entries or handovers
that are still queued on a guard's device. Ending site access can prevent those
queued records from syncing. Check affected outboxes before deactivation.

### Sprint 4 follow-up

- Exercise basemap failure and retry with an unavailable map style. The live
  browser review used a working provider.
- Verify site creation through the administrator browser workflow. The local
  API suite covered administrator creation and automatic assignment, and the
  browser review used the supervisor role.
- Review the size of the lazy-loaded MapLibre chunk and measure its effect on
  first map load.
- Address the three existing RLS performance warnings in
  [the geographic database contract](GEOGRAPHY_4B.md).
- Define a reconciliation workflow for device outboxes blocked by site
  deactivation. The server cannot detect records that are still on a phone.
- Reconcile the hosted schema before any approved rollout. Local verification
  covered disposable replay and the existing local stack.

## Sprint 5 overdue duty and Operations Overview

The forward migration is `20261125170757_sprint_5d_overdue_duty_recovery.sql`.
It adds the site-scoped `reconcile_overdue_duty` and
`get_operations_schedule` RPCs and extends the installed End Duty RPC without
changing its payload or receipt. Reconciliation uses the existing scheduling
transaction lock, revision check, audit table and operation UUID receipt.
The administrator's reason and reconciliation time are recorded separately
from checkout. Only a genuine guard submission can establish checkout.

An administrative reconciliation preserves the old reporting cutoff, planned
times, post snapshot, successor and recorded check-in. Where a frozen successor
exists and the guard has not submitted their handover, the successor's
assignment is protected for seven days from reconciliation. A submitted
handover independently protects its incoming assignment until that guard
acknowledges it. Reconciliation produces no acknowledgement or handover.

A delayed End Duty operation can add evidence to the completed duty if current
site authorization, the original assignment and its event time still qualify.
It cannot alter the next shift or extend or shorten the reconciled reporting
window. An authorized replay of an already received identical operation retains
its original receipt. A first arrival still has the seven-day event-age limit.
A legacy handover without a checkout timestamp cannot supply checkout after
reconciliation.

The Android app has an actor-scoped recovery-only view of the previous
verified assignment. Cached recovery requires the matching post/successor
record and expires after seven days since verification. Expired duty conveys
no permission to create a new incident or occurrence or update presence.
Local incidents, occurrences and handovers keep their existing queue and
retry states. An administrator cannot see whether a phone still holds queued
records. Check device outboxes before deactivating a site or removing access.
Missing access, an expired event, or a conflicting checkout can still block
replay. Leave that record on the phone and route it for manual review.

The Overview snapshot uses server time and Africa/Harare day boundaries.
Schedule and recorded check-ins are separate. Gap totals count posts with
documented gaps and separately show missing staffing or unavailable attendance.
An attendance record does not supply a GPS position. The Upcoming preview
covers today and the next six local days and lists up to 12 actionable records
per site. The roster remains available for the full schedule.

### Local verification

Replay all migrations on an isolated local PostgreSQL container using the
Storage bootstrap in [the geography contract](GEOGRAPHY_4B.md). After the
replay, use the CLI's local `migration up` against the existing Baseguard
stack. Confirm the CLI targets `127.0.0.1:54322`, compare record counts and
fingerprints before and after, and run local advisors.

```powershell
Get-Content -Raw supabase/tests/phase_5d_duty_recovery.sql |
  docker exec -i baseguard-phase5b-review psql -XqAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1
node supabase/tests/phase_4b_concurrency.mjs --phase5b
node supabase/tests/phase_5b_concurrency.mjs
node supabase/tests/phase_5d_concurrency.mjs
npm.cmd --prefix apps/supervisor run dev -- --host 127.0.0.1 --port 5186 --strictPort
```

Run `node supabase/tests/phase_5d_local_browser.mjs` with
`BASEGUARD_PLAYWRIGHT` set to an installed Playwright module entry point.
The browser must be Chrome and the supervisor environment must use the
loopback publishable configuration. This test provisions fictional local
`QA5D-*` records and retains them for review. Set `BASEGUARD_SCREENSHOTS`
to save images outside the tracked tree. The network fault discards the
first response only after the separate database check confirms the write
committed. Retry in the same editor reuses the operation UUID. Operation
IDs in the web editor are in memory and do not survive a full page reload.

Use a SQLCipher-enabled Android development client for device testing. Verify
overdue recovery after a cold start, local save and restart without network,
reconnect, matching server receipt, and a return to the next eligible shift.
For the scripted emulator test, run the local development client with Metro
on port 8098 and reverse ports 8098 and 54321 to the emulator. Point the guard
app to the loopback Supabase API with the local publishable key. Start at
the sign-in screen, then run `node supabase/tests/phase_5d_local_android.mjs`.
The script signs in with a fictional account and retains its `QA5D-MOBILE-*`
fixture. It removes only the Supabase port mapping during the offline step
and restores connectivity afterward. Verify the same flow separately on a
physical phone.

The local advisors report the prior incident-photo RLS initialization finding,
multiple policies on profiles/site assignments and the Phase 5B audit INSERT
policy overlap. Phase 5D adds a shifts UPDATE policy-overlap finding for the
internal scheduling role and adds the reconciliation policy to the existing
audit finding. The separate policies retain the scheduled-edit and
administrator-reconciliation checks. The four Phase 5D race workloads
observed follower completions of 380–419 ms, including Docker/client startup
and an intentional 250 ms hold. This measures contention in a small controlled
local workload. It is insufficient to estimate production throughput.
