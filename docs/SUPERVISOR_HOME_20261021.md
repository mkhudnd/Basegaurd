# SmartOps supervisor mobile home — spacious cards

Updated: 21 October 2026.

## Implemented mobile navigation

**Home · Incidents · Guards · Sites · More**.

The Home tab matches the approved spacious guard dashboard styling:

- Brand shield, Baseguard SmartOps wordmark and supervisor identity.
- Authorized **All assigned sites** / specific-site selector; no fake region structure.
- Spacious site summary with number of selected sites, on-duty guards, on-break guards, and open incidents.
- Server-received incidents awaiting acknowledgement banner (or no-new-incidents state).
- Four action cards: Incident Inbox, Guards, Sites and Shifts & Rosters.
- Recent activity from received incidents and occurrence entries only.
- Safety & Alerts section shows established emergency procedures, explicitly marking automatic SOS as unavailable.
- Five icon bottom tabs; account actions and other read-only workspaces under More.
- Refresh button, loading/error/empty states and Android hardware-back navigation.

## Existing functionality preserved

- Role routing in `apps/guard/App.tsx` unchanged. Guard login and encrypted SQLCipher outbox untouched.
- Supabase RLS-scoped reads from `sites`, `profiles` (current user), `incidents`, `occurrence_entries`, `shift_handovers`, and `shifts`.
- Live server `acknowledge_incident` RPC with confirmation and fresh read.
- Existing `InviteGuardScreen` remains wired to the deployed invite endpoint; invitations need SMTP/deep-link testing.
- Supervisor web app unchanged.

## Important limits

- Supabase currently has no `regions` entity. The dashboard shows assigned sites instead of fictional regions.
- Guard names from other profiles are not available under current profiles RLS. The Guards and Shifts views use real truncated guard IDs. Do not widen sensitive profile reads without a reviewed server-side API.
- Guard metrics count **distinct guards** in the latest 200 loaded active-shift rows. Incident totals are based on the latest 100 received incident rows. Values on a very busy multi-site deployment may be incomplete; the UI labels these bounds.
- Site addition, shift scheduling, complete handover acceptance, push delivery, GPS tracking and automatic SOS are not implemented here. Navigation must not imply these work.
- No new Supabase schema or migration is required: the `guard_duty_presence` migration already applied in the development project supplies `presence_status`.
- Offline incident drafts on the guard's phone cannot appear on the supervisor dashboard until confirmed by Supabase.

## Test

1. Sign in to Android with the **supervisor** test account, see Home.
2. Verify the assigned sites selector and select the fictional Training Site Alpha.
3. Inspect open incident count, open the inbox, and find server incident `BG-INC-000001` if still in the selected loaded window.
4. Open details and acknowledge a fictional, *unacknowledged* incident (never fabricate a real incident).
5. Switch to Guards and verify real duty/break statuses; invite workflow opens without errors.
6. Open Sites, Shifts, OB, More, then return Home using the Android Back button.
7. Sign out, sign back in as the **guard**, verify original guard Today and offline reporting still operate.
8. Test poor connectivity and authorization with an account assigned to a different site before any pilot.

**Validation**: JS/TSX syntax and Node unit tests can be checked here. This is not a claim of a finished native Android build or an on-device visual test.
