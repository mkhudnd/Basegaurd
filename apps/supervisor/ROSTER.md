# Supervisor scheduling review

The Shifts workspace uses the eight scheduling RPCs described in
[the Phase 5B contract](../../supabase/SCHEDULING_5B.md). The weekly grid, daily
roster and detailed list share the same model and use Africa/Harare dates.
Coverage is returned independently of the roster. Its metrics describe the
selected post and interval.

## Phase 5D review

- The roster shows overdue shifts and reconciliation history. An assigned
  administrator can reconcile an overdue shift. Checkout remains unknown
  until the server receives eligible guard evidence. The guard app can
  recover overdue End Duty from an actor-scoped cache.
- The authenticated local browser test dropped the first response after shift
  creation and reconciliation committed. Equivalent retries reused the UUID
  and returned the original receipt. Persistent web operation IDs remain a
  release follow-up because a full reload loses the current retry state.
- Verify that a large site's coverage queries remain responsive. Result pages
  come from the coverage RPC and may change if bookings or attendance change
  between requests.
- Repeat offline save, cold restart, and reconnect on a physical Android
  device. Assignment expiry can still block replay. See
  [local development](../../supabase/LOCAL_DEVELOPMENT.md#sprint-5-overdue-duty-and-operations-overview)
  for replay limits, lock measurements, and database advisor findings.

## Local browser review

The signed-in supervisor used the dedicated QA5C sites to exercise Week, Day
and List, site and record filters, adjacent bookings, redacted cross-site and
post-capacity conflicts, reassignment, cancellation and stale-revision review.
The administrator session verified capacity and staffing saves separately.
The temporary administrator login was signed out after verification.
