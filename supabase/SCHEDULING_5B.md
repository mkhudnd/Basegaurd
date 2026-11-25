# Phase 5B scheduling database

Baseline `ff351a0930c01f64a348b0a1d97b144767ced8f2` on
`feat/supervisor-web-redesign`. The forward migration is
`20261125124634_sprint_5b_scheduling.sql`.

## Data contract

- `public.shifts` retains its existing identity, site, guard, status, legacy
  duty window, check-in, post label and successor. New bookings set
  `scheduled_start_at`, `scheduled_end_at`, `shift_kind` (day, night or custom),
  `security_post_id` and `qualifying_assignment_id`. The membership must cover
  the entire booking. An expiry exactly at planned end is valid.
- The post reference uses `(site_id, security_post_id)`. Post renames preserve
  existing shift and handover labels. Ordinary scheduled edits preserve the
  label when the post ID is unchanged.
- `scheduling_revision` starts at 1. Guard check-in or checkout changes the
  scheduling state. `checked_out_at` captures the first confirmed client End
  Duty event time when it is consistent with check-in. A legacy submission
  without an event timestamp leaves actual checkout unknown. `ended_at` retains
  the legacy clamping behavior. Cancellation records a reason and keeps the row.
- `private.post_booking_capacity` holds the current maximum per post.
  `private.post_staffing_requirements` holds separately revised, non-overlapping
  active demand intervals. Absence and an explicit zero staffing requirement
  have different meanings. First structured booking requires explicit capacity.
- `private.scheduling_receipts` binds each operation UUID to actor, site,
  action and normalized input. Audit events use the existing audit table.
  Successful mutations, receipts and audit events commit together. A retry
  requires current authorization and returns the original receipt.

## RPCs

All scheduling endpoints require authentication and a current, matching-role
assignment to an active site. The public functions are security invokers. Their
internal executors are non-exposed and cannot log in or bypass RLS. The
read-only integrity role is separate from the site-scoped mutation role.

| RPC | Inputs and result |
| --- | --- |
| `save_scheduled_shift` | Operation UUID, site, optional shift ID, expected revision, guard, post, start, end, shift kind and optional successor. Null shift ID and revision zero create. Edits and reassignments require a future, unchecked-in scheduled shift. |
| `cancel_scheduled_shift` | Operation UUID, site, shift, expected revision and reason. Cancels an unchecked-in scheduled shift, including an expired booking if unprotected. |
| `save_post_booking_capacity` | Operation UUID, site, post, expected revision and capacity 1–100. Revision zero creates. Existing commitments limit reductions. |
| `save_post_staffing_requirement` | Operation UUID, site, post, optional requirement ID, expected revision, finite start and end, required count 0–100 and active flag. Revision zero creates. Overlapping active demand windows are rejected. |
| `list_roster` | Site, a bounded window of up to 31 days, optional post, paired start/ID cursor and limit up to 100. Returns ordered rows intersecting the window, including overnight rows and legacy operational windows. |
| `get_roster_shift` | Site and shift. Returns one authorized shift or SQL null if absent from scope. |
| `list_eligible_guards` | Site, bounded window, optional ID cursor and limit up to 100. Returns guard ID and display name for eligible accounts. This does not reserve a slot or imply availability. |
| `get_roster_coverage` | Site, bounded window and optional post. Returns time segments for active posts, including unbooked posts. Each segment carries configuration/revision information, capacity, required staffing, planned and confirmed attendance counts, and gaps where knowable. Coverage uses all authorized records for the range. |

Mutations return `operation_id`, `id`, `revision`, `status` and `received_at`.
Use `PT412` for stale revisions, `PT409` for booking/configuration conflicts or
changed operation retries, `PT422` for ineligible guard/post or invalid successor,
`PT423` for protected commitments, `22023` for malformed input and `42501`
for missing access. Cross-site overlap returns a generic guard-availability
message. Raw exclusion details never reach the scheduling caller.

| Actor | Read | Mutate |
| --- | --- | --- |
| Active assigned supervisor | Authorized roster, candidates and coverage | Schedule, revise, reassign, cancel |
| Active assigned administrator | Same authorized site scope | Supervisor operations and post capacity/staffing configuration |
| Active guard | Existing own shift and participant handover access | Existing duty, incident, occurrence and handover RPCs only |
| Anonymous, inactive or unassigned | No scheduling access | No scheduling access |

## Lock order and legacy interoperability

A transaction advisory lock serializes scheduling, post capacity, lifecycle and
duty mutations in this pilot. Scheduling RPCs, guard start/presence/End Duty/
handover writes and geographic site/post updates take the lock before row
locks. Statement triggers do the same for trusted direct writes to the covered
tables. Trusted code must acquire the lock before separately locking rows if
it will later mutate them. Use READ COMMITTED so the validation statements
can see the committed winner. The existing Sprint 4 site-row interlock still
coordinates site deactivation with incidents. The scheduling arbiter is global,
so measure contention before scaling the pilot.

Cross-site booking exclusion uses GiST UUID equality and half-open
`tstzrange` overlap. Legacy live rows contribute their original windows,
including open-ended rows. Post capacity uses the peak of concurrent
structured bookings, grouping starts and ends at a shared timestamp.
A partial unique index enforces one active row per guard, including overdue
rows. An overdue row blocks a new activation until checked out or reconciled.
The installed phone can lose its End Duty entry point after the legacy
window expires, and the existing time validation can reject very late events.
There is no new overdue-duty reconciliation workflow in this phase.

The migration preflights overlapping or non-finite live windows, duplicate
active guards and incompatible live successor relationships. It stops on
conflict and leaves prior records intact. It does not backfill historical
plans, checkout, post mappings or staffing. An unmapped legacy booking can
make gaps unavailable and is not credited to a structured post's capacity.

An outgoing shift freezes its successor, including an intentional null, once
active. Edits cannot reroute pending handovers. Structured pairs compare
post identity, legacy pairs retain exact text matching, and mixed links are
rejected. A checked-in structured successor that has already completed can
still receive a delayed submission from its protected predecessor. No
emergency link replacement is provided.

Coverage is derived from scheduled records and confirmed attendance
intervals. Future attendance and gaps are unavailable. A confirmed check-in
is not a geographic position. The database cannot see device-only
outboxes. Natural scope expiry and deactivation can still affect offline
replay despite interlocks on changes to active commitments.

## Local verification

Replay the eight baseline migrations and the scheduling migration in order
inside `baseguard-phase5b-review`, an isolated container using the local
Supabase PostgreSQL image and no shared volumes or network. Use the Storage
bootstrap approach in [the geography contract](GEOGRAPHY_4B.md), and wait
for the final PostgreSQL process to accept TCP connections inside the
container before importing. Apply each migration in a transaction. Create
conflicting legacy fixtures in a disposable transaction to confirm rollback
before a clean replay.

```powershell
Get-Content -Raw supabase/tests/phase_5b_scheduling.sql |
  docker exec -i baseguard-phase5b-review psql -XqAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1
Get-Content -Raw supabase/tests/phase_4b_geography.sql |
  docker exec -i baseguard-phase5b-review psql -XqAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1
node supabase/tests/phase_5b_concurrency.mjs
node supabase/tests/phase_4b_concurrency.mjs --phase5b
```

The concurrency runners commit disposable fixtures. SQL assertions roll back.
After successful replay, capture existing local record fingerprints and
policy/function metadata before incremental `supabase migration up`.
Check that the CLI identifies the loopback stack. Recheck history,
fingerprints, RLS, grants, extensions and advisors afterward. Keep
`QA4D-EEC7DEE8` browser fixtures intact. The SQL replay and app regressions
do not establish Android device integration.

## Phase 5B checkpoint results

- All nine migrations replayed in the disposable database. A conflicting
  open-ended legacy booking stopped preflight and the disposable transaction
  rolled back before any scheduling objects were created.
- The disposable suites passed 56 scheduling assertions, 10 scheduling
  concurrency checks, 74 geography assertions and eight geography concurrency
  checks. The Phase 4B concurrency fixtures use a separate activation guard
  to keep them valid under cross-site booking exclusion.
- Supabase CLI 3.4.0 applied only the scheduling migration to the existing
  loopback stack. All sampled pre-existing records, 29 existing public RLS
  policy definitions and six touched public mobile RPC signatures and grants
  matched the pre-migration inventory. The QA fixtures were preserved.
- All 14 public tables and three scheduling tables have RLS. All eight new
  public RPCs are invokers with authenticated execution. The checked
  application roles have no direct access to the three scheduling tables.
  The additional extension is `btree_gist` 1.7 in `scheduling_extensions`.
- The three existing performance warnings remain. The advisor added one
  internal-role performance warning because the geographic and scheduling
  audit policies are separate permissive INSERT policies for
  `smartops_geo_manager`. No new security warning was reported.
