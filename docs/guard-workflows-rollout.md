# Guard workflows rollout

Apply `supabase/migrations/202611190001_guard_workflows.sql` to a disposable Supabase project after the base schema and duty-presence migration. Deploy the native and web clients against that project for acceptance testing. Production rollout requires separate authorization.

An authorized roster administrator must provision each shift's site, guard, start/end, and post. Set the outgoing shift's `successor_shift_id` to the intended incoming shift. Use the same canonical post label for both shifts. Existing shifts receive nullable roster columns; no post, recipient, or check-in is inferred for historical data.

The server sets `checked_in_at` when a guard starts their assigned shift. A confirmed outgoing submission closes that shift. The incoming guard's subsequent receipt records `accepted_by` and `accepted_at`. The supervisor's pending list reads the server receipt. Offline operations are stored per account in the existing SQLCipher database.

## Reproduce the isolated integration check

Use Node 24 with built-in SQLite and TypeScript stripping. Install `@electric-sql/pglite` in an isolated test directory. Set `BASEGUARD_TEST_PGLITE` to the file URL for that installation's `dist/index.js`, then run `node tests/guard-workflows.mjs` from the repository root. The test creates disposable PostgreSQL roles with a local auth identity adapter and a temporary SQLite outbox. Physical-device acceptance should also cover SQLCipher, SecureStore, app process termination, reconnect, and role changes through actual Supabase Auth.
