# Baseguard SmartOps — Codex prototype workspace

**Status: interactive browser UX prototype + existing Android/web starter; not deployed and not production ready.**

This package combines the earlier Sprint 1 starter, original/revised Google Stitch HTML and screenshots, a functioning no-dependency browser clickthrough, and task instructions for OpenAI Codex. It is a **standalone Baseguard attachment project**; no company systems or ZimKraal are connected.

## Quickest way to try the clickthrough (Windows)

1. Extract the ZIP to `Desktop\Baseguard-SmartOps-Codex-Prototype`.
2. Open that folder in VS Code.
3. Open its integrated PowerShell terminal and run:

```powershell
node scripts/serve-demo.mjs
```

4. Open **http://127.0.0.1:8789** in a browser.
5. Select *Continue as Guard*, fill out a Report Incident form, save, open Sync Queue. Toggle *Simulated Online* and select *Simulate server receipt*. Switch to *Supervisor*, open the incident inbox, acknowledge, and close using a resolution note.

**The browser demo stores fictional data in localStorage only.** Simulated receipt is not real transmission; this is a clickthrough for UI testing. Do not type real incidents into it.

## How to use Codex to implement the Android native flow

Open the extracted project root in VS Code. Install the official Codex extension (or CLI), sign in with ChatGPT, and give Codex the contents of `docs/CODEX_TASK_01.md` as the task. `AGENTS.md` contains repository-level coding rules. Codex should work in `apps/guard/` and reuse the existing real `src/offline.ts` and server API. It must not substitute browser demo storage for the encrypted SQLite outbox.

For CLI users:

```powershell
npm install -g @openai/codex
codex
```

At the Codex prompt: `Implement docs/CODEX_TASK_01.md following AGENTS.md. Start by inspecting the code and creating a short plan. Make changes, run typechecks and tests, and report verification results.`

## Files

- `AGENTS.md` — persistent developer instructions for Codex.
- `docs/CODEX_TASK_01.md` — exact first implementation task and acceptance criteria.
- `prototype/` — responsive, interactive browser UX reference; no external JS packages.
- `tests/prototype.test.mjs` — Node-based test coverage for prototype transitions.
- `design/stitch-original/` and `design/stitch-additional/` — original design exports.
- `apps/guard/` — existing Expo React Native / Supabase / encrypted SQLite starter.
- `apps/supervisor/` — existing React/Vite supervisor starter.
- `supabase/schema.sql` — **unapplied** SQL staging schema for a dedicated project.
- `docs/SRS-v0.1.pdf`, `docs/ERD-v0.1.svg` — previous project specs.

## Verify interactive browser prototype

```powershell
node --test tests/prototype.test.mjs
```

The browser demo has no package installation step. It is independent of Expo and Supabase.

## Android native starter setup (after Codex has finished the task)

- Have Node.js, Android Studio / an Android phone with development tools, an appropriate Java environment and SDK ready.
- Create a **separate test Supabase project** with fictitious staff and site assignments; do not use ZimKraal's database.
- Do not run SQL against a real company database without approval.
- Set the publishable Supabase URL/key in `apps/guard/.env`, based on `.env.example`.
- In `apps/guard`, run `npm install`, `npx expo install --check`, `npx expo run:android`, and `npm run typecheck`.
- Expo Go cannot run the intended SQLCipher configuration; build a native dev client.

## Real limitations

- No live authentication or server synchronization in the **browser UX demo**.
- Android source exists but its native build and integration are not verified here.
- Shift handover acceptance, append-only corrections, evidence, admin tools and deployment need later phases.
- BYOD consent, privacy, regulatory and company supervisor approvals are required before real records.
- Emergency calls and radio procedures remain the authoritative urgent reporting path.
