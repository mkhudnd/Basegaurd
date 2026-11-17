# Baseguard SmartOps — Compact Duty Sheet + Break/Handover UI

21 October 2026 | React Native Expo SDK 54 | Patch based on earlier Guard Home update.

## Changes

- Replaced large in-place duty status popup with compact Android bottom sheet.
- Shows verified status with clear selected indicators. On Break has amber header/assignment treatment, a break-time banner and Resume button.
- Uses Supabase-provided `shifts.presence_updated_at` to show actual break start and elapsed time; counter is calculated on device from the last confirmed timestamp, not from a fictional schedule.
- `set_duty_presence` RPC response now supplies both confirmed presence and the server timestamp. On error, previous status remains.
- Offline status changes remain blocked. Previously verified values can appear while offline, explicitly marked as last confirmed.
- Off Duty directs to a useful *handover preparation* screen showing current assignment, local unsent count, manual checklist and links to queue and incidents.
- Electronic handover, shift ending, SOS dispatch, and automatic notifications are **not** implemented and must not be represented as functioning.
- No native package, DB schema or Supabase migration change; the pre-existing presence_updated_at column and RPC are reused.

## Apply

Extract the patch ZIP. On Windows PowerShell run:

```powershell
$folder = "$env:USERPROFILE\Downloads\Baseguard-Duty-Sheet-Update"
Expand-Archive -LiteralPath "$env:USERPROFILE\Downloads\Baseguard-SmartOps-Duty-Sheet-20261021-Patch.zip" -DestinationPath $folder -Force
powershell -NoProfile -ExecutionPolicy Bypass -File "$folder\APPLY_UPDATE.ps1"
cd "$env:USERPROFILE\Desktop\Baseguard-SmartOps-Codex-Prototype\apps\guard"
npx tsc --noEmit
npx expo start --dev-client -c
```

The installer pre-checks all modified files against the exact previous Guard Home release before modifying anything, and backs up their earlier versions to Downloads. If you modified these files separately, it will stop safely; upload your latest project ZIP rather than forcing an overwrite.

## Device checklist

1. Log in as test guard; open Today, confirm On Duty. Tap pill -> bottom sheet rises from lower edge, not under the header.
2. Tap On Break with internet available, wait for confirmation; header and assignment turn amber and the break banner appears.
3. Observe break duration change after 1+ minute and after leaving/returning to Today; tap Resume and confirm On Duty returns.
4. Turn off network: presence changes are disabled, but local incident/OB saves still work.
5. View Shift Details: actual shift start, break start when on break, assignment and shift ID visible; no invented shift end time.
6. Off Duty/Handover displays manual handover preparation, and server shift remains active. The app does **not** claim a completed handover.
7. Check small display, font scaling, Android system bars, bottom navigation and SOS emergency warning.
8. Confirm supervisor login and existing incident / OB sync features still work.

## Validation here

- Node 22 `--experimental-strip-types`: **18/18** mobile domain tests passed, including break duration.
- **4/4** prototype tests passed.
- `node scripts/static-check.mjs`: passed.
- 5 TypeScript/TSX changed source files: transpile/syntax diagnostics: **0 errors**.
- Full TypeScript dependency typecheck and Android device build remain unverified; an offline `npm ci` could not retrieve missing cached package `yocto-queue`.
