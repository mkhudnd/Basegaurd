# Occurrence Book redesign implementation notes

## Database contract preserved
- `public.occurrence_entries` has `category` in `routine`, `visitor`, `patrol`, `equipment`, `other`.
- Payload: `p_id`, `p_site_id`, `p_shift_id`, `p_category`, `p_narrative`, `p_event_at`.
- Local `created_at` is the time the guard SAVED the entry and `p_event_at` is the actual EVENT time.
- The server rejects event times outside the guard's shift, more than 5 minutes ahead, or older than 7 days; the client now checks the same rules.
- Server-only entries show server receipt but do not invent a local-save timestamp.

## UI mapping
Patrol details and visitor details are formatted as plain narrative lines. Equipment Check is the site's inspection/check workflow. Routine Duty and Other use a standard text description. This avoids a schema change or false claims of storing structured visitor data. Images are intentionally omitted until approved storage and retention design exists.

## Testing status
- `node --experimental-strip-types --test apps/guard/src/*.test.mjs apps/guard/src/auth/*.test.mjs`: 23/23 passed (in tool environment).
- `node scripts/static-check.mjs`: passed.
- TS/TSX syntactic parser checks: passed.
- `npx tsc --noEmit` unavailable in authoring environment because React Native dependencies did not install; must run on laptop.
- No device visual/running test has been performed.
