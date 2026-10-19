# SmartOps v0.1 — acceptance & verification checklist

**Status:** These are proposed tests, **not passing results**. Use fictional data in an isolated development project. Record actual results and evidence in your attachment logbook.

| Test | Procedure | Expected result | Implemented? |
|---|---|---|---|
| T01 | Sign in as provisioned guard | Assigned active shift shown | Code path present, untested live |
| T02 | Disable mobile internet, save OB, restart | Local entry remains queued | Code path present, untested on device |
| T03 | Reconnect, synchronize | Server receipt shown; same UUID | Code path present, untested live |
| T04 | Send exact same UUID three times | One server OB entry | RPC attempts idempotency; untested against PostgreSQL |
| T05 | Reuse UUID with changed content | Conflicting-operation error | RPC checks payload; untested |
| T06 | Guard queries unrelated site | RLS denies row | Policies present; untested live |
| T07 | Supervisor assigned to Site A queries Site B | RLS denies Site B | Policies present; untested live |
| T08 | Guard calls acknowledge_incident | Permission denied | RPC checks role; untested live |
| T09 | Supervisor acknowledges new incident | State becomes acknowledged with update history | Code path present, untested live |
| T10 | Revoke guard assignment while offline | Subsequent server sync denied; local entry retained | Code path present, untested live |
| T11 | Sign out with unsent records | Sign out blocked and data preserved | Code path present, untested on device |
| T12 | Sign out with all records received | Local database rows cleared | Code path present, untested on device |
| T13 | Reopen encrypted database without key | Database cannot be read | Requires SQLCipher-enabled Android build |
| T14 | Try Expo Go | Deployment rejected as unsupported for encrypted database | Explicitly not a supported test environment |
| T15 | Supervisor browser Print / Save PDF | Filtered OB visible | Code path present; print test pending |
| T16 | Guard creates handover | Not implemented | Sprint 2 |
| T17 | Correct immutable OB entry | Not implemented | Sprint 2 |
| T18 | Supervisor resolves/closes an incident | Not implemented | Sprint 2 |

## Academic evaluation targets

- 30 controlled queued reports restored and delivered exactly once after reconnection.
- Every cross-site access test denied server-side.
- 90-second average routine-entry target measured with trained pilot participants.
- Usability interviews before and after the prototype.
- Comparison of retrieval time: paper records versus digital reports (under approved, equivalent test tasks).

## Deployment/approval gates

- [ ] IT supervisor accepts problem statement and module list.
- [ ] Security operations manager approves pilot sites, staff and procedure.
- [ ] Relevant staff consent/BYOD guidelines established.
- [ ] Data-protection assessment, storage geography, retention/deletion and incident disclosure process agreed.
- [ ] Native SQLCipher encryption independently verified on actual Android test phones.
- [ ] PostgreSQL function privileges, grants, RLS, cross-site denial and idempotency independently tested.
- [ ] App lock, lost-phone process and token revocation tested.
- [ ] Emergency phone/radio processes clearly maintained.
- [ ] Backups, incident recovery and migration/rollback procedures agreed.
