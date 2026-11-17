# Guard Today redesign and duty presence — 21 Oct 2026

## Scope
- `apps/guard/src/screens/TodaysDutyScreen.tsx`: refined Today home matching approved mockup: brand/shield, real duty site, responsive quick action tiles, honest local outbox strip, recent local activity, emergency procedures card, duty menu and shift details.
- `apps/guard/src/components.tsx`: standard Ionicons for all four bottom-navigation tabs.
- `apps/guard/App.tsx`: links duty changes to a server-confirmed RPC, uses the existing Handover tab without pretending to end a shift.
- `apps/guard/src/guard-service.ts`, `src/offline.ts`, `src/duty-presence.ts`: shift presence query and guarded RPC integration. The encrypted SQLCipher outbox is not modified beyond a TypeScript optional duty property.
- `supabase/migrations/20261021095939_guard_duty_presence.sql`: stores on-duty / on-break independent of shift lifecycle; audit events; restricted function.

## Existing development Supabase project
The migration is ALREADY applied to `baseguard-smartops-dev` (`paggkijvrsveqehfdfag`) through the Supabase connector as migration `20261021095939_guard_duty_presence`. **Do not run this migration twice against this project**. Other isolated/new projects may apply it once after the initial schema.

The authenticated, active guard assigned to the active shift may invoke `set_duty_presence(p_shift_id,p_presence_status)` with `on_duty` or `on_break`. The database verifies identity, current shift, active site assignment and server time. It returns confirmed status, records audit changes and leaves the shift active when on break. It grants NO direct shift-table update privileges.

## Deliberate limitations
- Off Duty sends the guard to the existing planned Handover screen with an explicit warning. It does **not** end the shift or fabricate a submitted handover.
- The red safety tile opens emergency-procedure instructions. Push SOS / automatic sensor distress alerts and geo-monitoring are **not** implemented and MUST NOT be advertised as active.
- The backend tracks presence, but displaying other guards' break states on the supervisor dashboard is a separate UI task.
- Actual shift end time is not part of the current `shifts` schema. The Today screen shows verified shift start and `Ongoing` rather than an invented 06:00–18:00 schedule.
- Offline cached assignments cannot confirm duty presence or change it without server access. Queued incidents are not treated as received.

## Suggested Android acceptance checks
1. Guard login, verify Today contains assignment Training Site Alpha and On Duty status.
2. Tap On Duty → On Break. Wait for server confirmation. Refresh and verify persisted On Break.
3. Tap On Break → On Duty. Verify server update; test offline mode blocks status changes.
4. View Shift Details → inspect site/start time/status/shift ID; Sign out still blocks unsent records.
5. Tap all four actions and bottom navigation tabs; confirm original incident/offline workflows remain functional.
6. Open Off Duty → view Handover placeholder; ensure server shift is unchanged.
7. Tap Safety → see emergency-procedure notice, with no simulated SOS success.
8. Test at Android widths 360, 393 and 412; long site names; large fonts; Android status and navigation bars.
