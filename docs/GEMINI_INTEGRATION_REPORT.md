# Gemini guard UI integration checkpoint

The seven guard incident-journey screens and two shared source files in `handoff/gemini-ui/` are the visual baseline. `apps/guard/App.tsx` owns session, route and loading state. `apps/guard/src/presentation-adapter.ts` translates real local and server records into the screen props. The screens do not import Supabase, SQLite or the sync engine.

## Screen-to-service mapping

| Gemini screen | Route in `App.tsx` | Real source and action |
|---|---|---|
| Login | `/guard/login` | `supabase.auth.getSession`, `onAuthStateChange`, `signInWithPassword`; no demo bypass. |
| Today's Duty | `/guard/today` | `loadDuty` checks an active, time-valid shift and assigned site; `cachedDuty` supports labeled offline context; `loadGuardName` reads the signed-in profile. |
| Report Incident | `/guard/incidents/new` | Form keeps editable fields; `saveIncidentPayload` repeats domain validation and queues a UUID in encrypted SQLite. Successful local save opens status; storage failure retains the form. |
| Submission Status | `/guard/submission/:id` | `LocalRecord.state`, local UUID, and validated receipt/ref only; sync action runs the existing sync service. |
| Sync Queue | `/guard/queue` | `listRecords`, `syncRecords` and filtered `syncRecord` retry; failure remains on device with the same UUID. Received rows are displayed separately. |
| Incident History | `/guard/incidents` | Merges owner-local rows with RLS-permitted `incidents` rows, de-duplicated by UUID. A queued local row never inherits a server receipt from a matching remote row. |
| Incident Details | `/guard/records/:id` | Local record or permitted server incident, plus `incident_updates` for separately verified supervisor state. Queued rows cannot show a server reference or acknowledgement. |

`Today | OB | Incidents | Handover` remains the tab hierarchy. OB still uses the existing categorized SQLite/RPC path. Handover is an explicit Sprint 2 placeholder without submit or accept controls. Native Back returns to the originating queue, submission or history view. Sign-out checks for unsent rows; a new account cannot see the prior account's data.

## Contract reconciliation

The prior `SCREEN_CONTRACTS.md` table described raw `Duty`/`LocalRecord` inputs and container-owned form fields. Gemini supplied view-specific summaries and internal form inputs. `App.tsx` now passes typed summaries from `presentation-adapter.ts` and handles callbacks; raw records never enter Gemini views. `LoginScreen` owns email/password input and calls the existing auth callback. `ReportIncidentScreen` owns its draft and emits a typed payload; the service repeats authoritative validation before SQLite save. Today's Duty receives a mapped shift context and separate cache indicator. Status, queue and history receive UUID, local state and nullable receipt fields. Details combines local rows with a permitted server read; acknowledgement requires that separate read. These are prop/adapter changes, not new data contracts or direct service calls in the views.

## Visual preservation and necessary adjustments

All nine staged Gemini source files were adopted. `components.tsx` was already staged in the working tree before this integration. The seven screens keep Gemini's card layout, hierarchy, colors, badges and spacing. Changes within view files are limited to type/contract fields and truthful runtime labels: cached duty, server-only history, missing local save time, sending versus receipt, and the received section in the outbox. Login requests the Supabase account email. The staged Noto Sans family names had no bundled fonts, so Android system sans-serif is used. Several tap targets were raised to 48 px. No alternate incident screen or theme was added.

The raw Gemini files remain in `handoff/gemini-ui/` as a comparison reference. Current presentation files are `apps/guard/src/components.tsx`, `apps/guard/src/ReportIncidentScreen.tsx`, and `apps/guard/src/screens/*.tsx`. Core behavior stays in `api.ts`, `offline.ts`, `sync-engine.ts`, `incident-domain.ts`, `guard-service.ts` and the app controller. The only core changes here are a filtered retry wrapper and read-only permitted incident/history services; no SQL or RLS changes were made. The server incident feed is capped at the latest 100 own reports; it is not a paginated complete history.

## Verification and limits

| Check | Result |
|---|---|
| Guard TypeScript | Passed: `npm run typecheck`. |
| Guard unit tests | Passed: 12 tests, 0 failures (`npm test` with Node 24). Three adapter tests cover pending receipt isolation and server-only history. |
| Expo dependencies | Passed: `npx expo install --check` reported dependencies up to date using its local compatibility map; online validation was unavailable. |
| Android JS/Hermes bundle | Passed: `npx expo export --platform android`, 687 modules, with temp path inside workspace. |
| Native Android APK | Passed: x86_64 debug `assembleDebug`, 257 Gradle tasks (202 executed, 55 up to date), APK 112,620,886 bytes. Generated config retained `expo.sqlite.useSQLCipher=true`; APK contains `libexpo-sqlite.so` and `libcrypto.so`. This proves compilation, not at-rest encryption or runtime behavior. |
| Supervisor | Passed: `npm run typecheck` and `npm run build` (Vite: 100 modules). |
| Static SQL/source check | Passed: `node scripts/static-check.mjs` (11 RLS table declarations and three restricted RPCs). It does not test a database. |
| Device and isolated Supabase flows | Not run: no Android device attached and no isolated Baseguard test account/project was used. Offline persistence, app restart, failed RPC retry, cross-site denial, and screenshots at 360/393/412 px remain device/integration acceptance checks. |

The native build required a temporary override in the ignored generated `apps/guard/android/` checkout to use the already installed NDK 27.1.12297006; the default NDK 27.0.12077973 download stalled at zero bytes. The default new-architecture build then failed because a generated CMake object path exceeded Windows' 260-character limit. The successful verification build used `-PnewArchEnabled=false -PreactNativeArchitectures=x86_64`. A short drive mapping was tried but React Native codegen rejected mixed drive roots. These environment-only changes were not committed. The local Node 20 test attempt could not load TypeScript source; the committed test command passes with bundled Node 24.

## Run on Android

Use Node 24, an Android emulator or USB device, and an **isolated** Supabase test project with fictional guard, site, assignment and active shift. In `apps/guard`, copy `.env.example` to ignored `.env` and set only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Run `npm ci`, `npx expo install --check`, `npm run typecheck`, `npm test`, then `npx expo run:android`. The default build needs a working SDK NDK install and a sufficiently short Windows checkout path for React Native codegen. Expo Go cannot validate SQLCipher. The built x86_64 debug APK is an ignored local artifact at `apps/guard/android/app/build/outputs/apk/debug/app-debug.apk`; its Metro JavaScript still requires the configured project when launched.

This is a proposed pilot, not production acceptance. No production database or ZimKraal system was accessed.

## Android phone build (follow-up)

An installable debug APK was subsequently built with `arm64-v8a` and `x86_64` native libraries using the ignored generated Android checkout: `gradlew assembleDebug --no-daemon -PnewArchEnabled=false -PreactNativeArchitectures=arm64-v8a,x86_64`. Gradle finished successfully (261 actionable tasks: 22 executed, 239 up to date). The 130,105,983-byte APK is `apps/guard/android/app/build/outputs/apk/debug/app-debug.apk`, SHA-256 `C780FFBDD679AE37E688FEB9459FEEB949210C1AF0F0F7109702B6CE51D8F284`. APK signature verification passed with the Android debug certificate. Both ABIs contain `libexpo-sqlite.so` and `libcrypto.so`; the generated build retains `expo.sqlite.useSQLCipher=true`.

This is a debug app that needs Metro and an isolated test `.env` to load the JavaScript and reach Supabase. `expo-dev-client` was not installed because the package download could not complete in this environment; there is no development-client QR launcher in this APK. No Android device was attached for installation or runtime testing. The APK is generated and ignored by Git, not a production or offline standalone release.
