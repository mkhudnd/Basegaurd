# Personnel management backend contract

Sprint 3 uses `supabase/proposals/site_personnel_directory.sql` as a review-only
contract. It is not a migration and has not been applied. The proposal exposes only
guard ID, operational display name, account-active state, site assignments and duty
facts already present in RLS-protected tables. It does not expose email addresses,
credentials, phone numbers, addresses or Auth administration.

The directory RPC is `security invoker`; underlying RLS remains authoritative. The
only privileged helper is a boolean site-access check in the non-exposed `private`
schema. The same directory result supplies display names to incidents, shifts,
handovers and dashboard details, with UUID references retained as a safe fallback.

Supported mutation:

- `invite-guard` is an existing JWT-protected Edge Function. It performs authorization
  from server-fetched profiles and site assignments, keeps the service-role key inside
  the function, rate-limits invitations and writes an audit event.

Not currently supported:

- editing guard profile fields;
- activating or deactivating Auth or profile accounts;
- changing site/post assignments;
- creating shift assignments;
- permanent personnel deletion;
- a separate employment-status or attendance table.

The UI labels these capabilities unavailable and does not simulate successful writes.
Attendance is derived only from confirmed `shifts.checked_in_at` values.
