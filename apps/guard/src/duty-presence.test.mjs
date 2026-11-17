import test from 'node:test';
import assert from 'node:assert/strict';
import {dutyPresenceLabel,canChangeDutyPresence,OFF_DUTY_REQUIRES_HANDOVER,breakDurationLabel} from './duty-presence.ts';

test('duty presence reflects confirmed server values and does not invent an offline status',()=>{
 assert.equal(dutyPresenceLabel('on_duty'), 'On Duty');
 assert.equal(dutyPresenceLabel('on_break'), 'On Break');
 assert.equal(dutyPresenceLabel(null), 'Status Unavailable');
});
test('duty changes require online verified active shift, not a cached assignment',()=>{
 const data={shiftId:'shift1',isOnline:true,isCachedDuty:false,isBusy:false};
 assert.equal(canChangeDutyPresence(data), true);
 assert.equal(canChangeDutyPresence({...data,isOnline:false}), false);
 assert.equal(canChangeDutyPresence({...data,isCachedDuty:true}), false);
 assert.equal(canChangeDutyPresence({...data,shiftId:null}), false);
 assert.equal(canChangeDutyPresence({...data,isBusy:true}), false);
});
test('off duty is never a client-side local toggle',()=>{
 assert.equal(OFF_DUTY_REQUIRES_HANDOVER,true);
});

test('break duration is calculated from server timestamp with no invented duration',()=>{
 const now=Date.parse('2026-10-21T11:00:00Z');
 assert.equal(breakDurationLabel('2026-10-21T10:59:35Z',now),'Less than 1 min');
 assert.equal(breakDurationLabel('2026-10-21T10:48:00Z',now),'12 min');
 assert.equal(breakDurationLabel('2026-10-21T09:43:00Z',now),'1 h 17 min');
 assert.equal(breakDurationLabel('2026-10-21T08:00:00Z',now),'3 h');
 assert.equal(breakDurationLabel(null,now),null);
 assert.equal(breakDurationLabel('invalid',now),null);
 assert.equal(breakDurationLabel('2026-10-21T11:05:00Z',now),null);
});
