# Guard incident journey — verification and Android handoff

## Implementation scope

The native guard app uses the existing Supabase password sign-in, server-filtered duty
query, SQLCipher SQLite outbox, UUID operation IDs, and RPC sync. The incident form
stores an edited event time in the existing `submit_incident.p_reported_at` argument.
That argument is the event timestamp in the current SQL function. The local
`created_at` is the distinct phone save time. Optional immediate actions are appended
to the RPC description, within its 3,000-character limit. No migration is needed.

The app uses the Android system sans-serif font fallback. Noto Sans has not been
bundled or licensed. Stitch supplied layout and palette references only; its
simulated telephony, radio channels, tracking, and guaranteed background sync claims
were not implemented. Handover remains a Sprint 2 placeholder. Acknowledgment is
shown as unavailable because the guard app does not yet fetch server follow-up state.

## Checks run in this workspace

| Check | Result |
|---|---|
| `node --test apps/guard/src/incident-domain.test.mjs` | 8 passed, 0 failed |
| `node --test tests/prototype.test.mjs` | 4 passed, 0 failed |
| Dependency install | Blocked: npm is absent; bundled pnpm attempted registry fetches and received `EACCES` |
| `npx expo install --check` | Could not run without npm/installed Expo CLI |
| `npm run typecheck` | Could not run without npm/installed TypeScript |
| Android build and 360/393/412px layout | Not run; no installed Expo dependencies or connected Android target |
| Physical SQLCipher persistence and server RLS/RPC | Not run; needs a dev build and isolated Supabase project |
| Screenshots | Not captured; Android app could not be built in this environment |
| Git commits | Blocked: workspace allows source edits but denies writes to `.git/index.lock` |
| Temporary pnpm store cleanup | Automatic approval review rejected the recursive removal; `.pnpm-store/` is ignored by Git |

## Android development build procedure

1. In `apps/guard`, copy `.env.example` to `.env` and set the URL and **publishable**
   key of an isolated Supabase test project with fictional guard, site, assignment,
   and shift data. Do not use a service-role key.
2. Use Node 24 for the built-in TypeScript test runner. Run `npm install`,
   `npx expo install --check`, `npm run typecheck`, and `npm test`. Resolve any
   Expo compatibility suggestions before building.
3. Run `npx expo run:android` with Android Studio or a USB-connected phone.
   This must create a native development build with `useSQLCipher: true`.
   Expo Go cannot validate or run the encrypted outbox.
4. Sign in as an assigned guard. At 360px, 393px, and 412px widths, inspect
   header, form chips, date/time field, keyboard access, save/cancel buttons,
   status cards, queue rows, and bottom tabs. Capture screenshots for queued,
   failed, sending, received, history, and details.
5. Disable connectivity, save a report with an event time earlier than save
   time, restart the app, and verify the same UUID and `Pending Sync` state remain.
   Double-tap Save and verify only one local row is created.
6. Reconnect and tap Sync now. Verify server receipt ID, public number, and
   received timestamp against the Supabase test database. Repeat sync and
   verify one server row for the UUID.
7. Revoke the fictional guard's site assignment or expire the shift in the
   test project, retry a pending record, and verify it remains local with a
   failure message. Check that a guard cannot read another site's rows or call
   `acknowledge_incident`.
8. Inspect an unsent and a received record. Only the received record should
   show a server reference. Neither should claim supervisor acknowledgment
   until a real follow-up query is implemented.

Do not use real incident data for these tests. The native app and database behavior
remain unverified until these steps are executed.
