# Navigation map

Routes below are **logical screen IDs**, not deep links. Guard navigation is local `page`/`tab` state in `apps/guard/App.tsx`; supervisor navigation is local `view` state in `apps/supervisor/src/main.tsx`. There is no Expo Router or browser URL router.

```text
Guard auth loading → /guard/login → /guard/today
                                ├─ /guard/ob → /guard/ob/new → /guard/submission/:id
                                ├─ /guard/incidents → /guard/incidents/new → /guard/submission/:id
                                │                      └─ /guard/records/:id
                                ├─ /guard/handover (Sprint 2 placeholder)
                                └─ /guard/queue → /guard/records/:id
/guard/submission/:id → /guard/queue | /guard/incidents | /guard/today
/guard/records/:id → originating queue/history; history button → matching OB/incidents tab

Supervisor auth loading → /supervisor/login → /supervisor/overview
                                           ├─ /supervisor/incidents
                                           └─ /supervisor/occurrences
```

The guard bottom tabs are Today, OB, Incidents, Handover. Hardware Back closes details to its queue/history origin, closes queue/submission/form to tabs, and closes the inline OB form. Sign-out returns to login after checking for unsent local records. Session and selected IDs live in the app controller, not in presentation components. On app foreground, the guard attempts sync and refresh; this is best effort, not a delivery guarantee.

## Deferred routes in Stitch/prototype only

`/guard/ob/:id/correction`, `/guard/handover/new`, `/guard/handover/incoming`, `/supervisor/incidents/:id/review`, `/supervisor/sites`, `/supervisor/staff`, `/supervisor/reports`, and `/supervisor/audit` have no working deployable route. The browser prototype's role switch, simulated online toggle, simulated receipt, acknowledgement and close flows are demonstration navigation only.
