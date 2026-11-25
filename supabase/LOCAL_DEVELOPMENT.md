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
