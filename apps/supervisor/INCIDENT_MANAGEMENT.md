# Incident management backend contract

Sprint 2 uses the existing site-scoped incident, shift, incident update and incident
photo policies. The browser requests private evidence through a five-minute signed URL.
Creating that URL still requires the authenticated supervisor to pass the existing
`storage.objects` select policy.

The current backend has these limits:

- supervisors can see the reporting guard UUID through an incident, but the `profiles_self`
  policy does not expose the guard's display name;
- incidents have no coordinates, accuracy or capture timestamp;
- `audit_events` is deliberately unavailable to clients, so the UI timeline combines the
  incident event, confirmed receipt and authorized `incident_updates` records;
- the response RPC supports progress and resolution, while closure has no RPC;
- the photo schema supports one JPEG per incident.

`supabase/proposals/incident_close.sql` is a review-only proposal for the missing close
transition. It is outside the migration directory and has not been applied. Incident
location requires an approved data model and guard submission contract before a migration
is written. The UI already treats optional WGS84 coordinates as an independent map layer.
