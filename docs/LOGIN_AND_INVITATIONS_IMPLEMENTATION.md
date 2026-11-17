# Baseguard SmartOps — Login, roles, and invitations (21 Oct 2026)

## Scope

- Approved forest-green / navy login redesign under `apps/guard/src/auth/LoginScreen.tsx`.
- Existing Supabase email/password sign-in, password recovery, invite-first password setup.
- Guard/supervisor/admin role verified from **server-owned** `public.profiles`; no role selection at login.
- Guard workspace remains the existing offline SQLCipher UI and retains its protection against signing out with unsent records.
- Supervisor workspace is server-driven: site selector, incident inbox, incident detail and acknowledgement, OB review, read-only handovers, Staff / Invite Guard.
- Existing supervisor web app is unchanged.
- Invitation endpoint already deployed on the **development** project: `invite-guard`; source template copied to `supabase/functions/invite-guard/index.ts` for review. No client service key.

## Test account journey

1. Sign in as the existing guard: should open Today's Duty and preserve incident/OB/offline behavior.
2. Sign in as the existing supervisor: should open Overview with a visible Incidents tab, and display server-received incident BG-INC-000001 at Training Site Alpha.
3. Open Staff > Invite guard. Enter a **new fictional email address** that does not already have a Supabase Auth account, name and site; send invite.
4. On a phone with the dev client installed, open invitation email; verify account is activated only after password setup. Refresh/verify email template and Supabase redirect allowlist as needed.
5. Newly invited guard has a profile and site assignment, **not a shift**; provision a test shift separately before testing incident submission.
6. Forgot Password > password reset email > deep-link > choose a new password > log in again.
7. Test unauthorized guard cannot open supervisor tools, and supervisor cannot view unrelated sites or invoke restricted operations.

## Supabase prerequisites

- Project ref: `paggkijvrsveqehfdfag` (DEVELOPMENT ONLY)
- Android scheme: `baseguard-smartops` (already present in app.json and Android manifest).
- Auth redirect allowlist must include `baseguard-smartops://auth/callback` and potentially `baseguard-smartops://auth/callback?flow=*` for this exact workflow. Review with actual test messages.
- Verify SMTP delivery quotas/provider setup. Do not assert an email was delivered until tested.
- Edge function `invite-guard` needs its inherited server-side Supabase service-role environment; the secret never goes in the Android app.
- The public login screen deliberately does **not** offer self-registration or officer-ID login (not backed by this authentication flow).
- Remember-device checkbox was omitted rather than offering a misleading toggle; session is persisted using the existing Expo SecureStore auth adapter.

## Test results from this environment

- Guard domain, adapter and role helper tests: 14/14 passed using Node 22 `--experimental-strip-types`.
- Project static schema/outbox validation: passed.
- Changed TS / TSX files: syntax transpilation passed.
- Full dependency-backed TypeScript check, Android native build, real-device invitation links and user flows: **not run**. `npm ci` could not complete because of npm registry/network/cache limitations in this environment.

## Non-goals

- Full guard directory, shift-creation UI, site management and SMS invitations are not implemented.
- Push notifications, geolocation and distress detection are separate future phases requiring safety/privacy review.
- This is not an emergency dispatch application. Continue approved emergency phone/radio procedures.
