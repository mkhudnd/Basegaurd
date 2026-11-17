import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDescription,confirmedReceipt,localDateTime,makeQueuedPayload,parseLocalDateTime,statusLabel,validateIncident,validateOccurrence,validateOccurrenceEvent,withSubmissionLock} from './incident-domain.ts';
import {syncPending} from './sync-engine.ts';

const now=Date.parse('2026-10-19T12:00:00.000Z');
const duty={started_at:'2026-10-19T06:00:00.000Z',ended_at:null,fetched_at:'2026-10-19T11:00:00.000Z'};
const draft={category:'theft',severity:'high',eventAt:'2026-10-19T09:00:00.000Z',narrative:'Observed a damaged storage lock.',actions:''};
test('incident validation checks event, shift, and narrative',()=>{
 assert.equal(validateIncident(draft,duty,now),null);
 assert.match(validateIncident({...draft,narrative:'short'},duty,now),/20 characters/);
 assert.match(validateIncident({...draft,eventAt:'2026-10-19T05:00:00Z'},duty,now),/assigned shift/);
 assert.match(validateIncident({...draft,eventAt:'2026-10-19T13:00:00Z'},duty,now),/five minutes/);
 assert.match(validateIncident(draft,null,now),/Reconfirm/);
 assert.match(validateIncident(draft,{...duty,fetched_at:'2026-10-18T00:00:00Z'},now),/Reconfirm/);
 assert.equal(buildDescription({...draft,actions:'Notified supervisor.'}),'Observed a damaged storage lock.\n\nImmediate actions: Notified supervisor.');
});
test('OB validation follows duty window and server length limits',()=>{
 assert.equal(validateOccurrence('routine','Guard noted routine inspection.',duty,now),null);
 assert.match(validateOccurrence('visitor','short',null,now),/Reconfirm/);
 assert.match(validateOccurrence('invalid','Valid narrative here.',duty,now),/category/);
 assert.match(validateOccurrence('routine','x'.repeat(3001),duty,now),/3,000/);
});
test('local time parser round trips and rejects rolled dates',()=>{
 const value='2026-10-19 14:05';
 assert.equal(localDateTime(parseLocalDateTime(value)),value);
 assert.equal(parseLocalDateTime('2026-02-30 14:05'),null);
});
test('queued payload keeps local ID, site, shift, and edited event time',()=>{
 const payload=makeQueuedPayload('incident','uuid-1','site-1','shift-1',draft,'2026-10-19T12:00:00Z');
 assert.equal(payload.p_id,'uuid-1');assert.equal(payload.p_site_id,'site-1');assert.equal(payload.p_shift_id,'shift-1');
 assert.equal(payload.p_reported_at,draft.eventAt);
 assert.notEqual(payload.p_reported_at,'2026-10-19T12:00:00Z');
});
test('receipt and labels never equate queued or failed with received',()=>{
 assert.match(statusLabel('queued'),/Pending Sync/);
 assert.match(statusLabel('failed'),/Sync Failed/);
 assert.match(statusLabel('sending'),/Awaiting Receipt/);
 assert.throws(()=>confirmedReceipt({id:'id',received_at:'2026-10-19T12:00:00Z'},'id','incident'),/reference/);
 assert.throws(()=>confirmedReceipt({id:'wrong',public_number:'BG-INC-1',received_at:'2026-10-19T12:00:00Z'},'id','incident'),/receipt/);
 assert.deepEqual(confirmedReceipt({id:'id',public_number:'BG-INC-1',received_at:'2026-10-19T12:00:00Z'},'id','incident'),
  {receivedAt:'2026-10-19T12:00:00Z',publicNumber:'BG-INC-1'});
});
test('failed sync retains UUID and retry receives only after valid receipt',async()=>{
 const item={id:'fixed-id',kind:'incident',payload:JSON.stringify({p_id:'fixed-id',p_site_id:'authorized-site'})};
 let state='queued',attempts=0;
 const seen=[];
 const adapter={
  pending:async guard=>{assert.equal(guard,'guard-1');return state==='received'?[]:[item];},
  markSending:async id=>{assert.equal(id,item.id);state='sending';},
  submit:async(_kind,args)=>{attempts++;seen.push(args.p_id);if(attempts===1)throw Error('network unavailable');
   return {id:args.p_id,public_number:'BG-INC-1',received_at:'2026-10-19T12:00:00Z'};},
  markReceived:async id=>{assert.equal(id,item.id);state='received';},
  markFailed:async(id,error)=>{assert.equal(id,item.id);assert.match(error,/network/);state='failed';}
 };
 assert.deepEqual(await syncPending('guard-1',adapter),{sent:0,failed:1});
 assert.equal(state,'failed');
 assert.deepEqual(await syncPending('guard-1',adapter),{sent:1,failed:0});
 assert.equal(state,'received');
 assert.deepEqual(await syncPending('guard-1',adapter),{sent:0,failed:0});
 assert.deepEqual(seen,['fixed-id','fixed-id']);
});
test('local payload ID mismatch cannot be submitted',async()=>{
 let submitted=false,failed=false;
 const adapter={
  pending:async()=>[{id:'one',kind:'incident',payload:JSON.stringify({p_id:'two'})}],
  markSending:async()=>{},
  submit:async()=>{submitted=true;},
  markReceived:async()=>{},
  markFailed:async()=>{failed=true;}
 };
 assert.deepEqual(await syncPending('guard-1',adapter),{sent:0,failed:1});
 assert.equal(submitted,false);assert.equal(failed,true);
});
test('sync processes only records returned for the authenticated guard',async()=>{
 let calls=0;
 const rows=[{id:'a',kind:'incident',author:'guard-a',payload:JSON.stringify({p_id:'a'})}];
 const adapter={pending:async guard=>rows.filter(row=>row.author===guard),markSending:async()=>{},
  submit:async()=>{calls++;return null;},markReceived:async()=>{},markFailed:async()=>{}};
 assert.deepEqual(await syncPending('guard-b',adapter),{sent:0,failed:0});
 assert.equal(calls,0);
});
test('rapid duplicate Save calls run one write and release lock after failure',async()=>{
 const lock={current:false};let writes=0;let release;
 const first=withSubmissionLock(lock,async()=>{writes++;await new Promise(resolve=>{release=resolve;});return 'saved';});
 const second=withSubmissionLock(lock,async()=>{writes++;return 'duplicate';});
 assert.equal(await second,undefined);assert.equal(writes,1);
 release();assert.equal(await first,'saved');
 await assert.rejects(withSubmissionLock(lock,async()=>{throw Error('storage failed');}),/storage failed/);
 assert.equal(lock.current,false);
 assert.equal(await withSubmissionLock(lock,async()=>{writes++;return 'retry';}),'retry');
 assert.equal(writes,2);
});

test('occurrence payload retains selected event time, distinct from saved time',()=>{
 const eventAt='2026-10-19T09:30:00.000Z';
 assert.equal(validateOccurrenceEvent('patrol','Patrol completed at the main gate.',eventAt,duty,now),null);
 assert.match(validateOccurrenceEvent('patrol','Patrol completed at the main gate.','not-a-time',duty,now),/valid occurrence date and time/);
 assert.match(validateOccurrenceEvent('patrol','Patrol completed at the main gate.','2026-10-19T05:30:00.000Z',duty,now),/assigned shift/);
 assert.match(validateOccurrenceEvent('patrol','Patrol completed at the main gate.','2026-10-19T12:06:00.000Z',duty,now),/five minutes/);
 assert.match(validateOccurrenceEvent('patrol','Patrol completed at the main gate.','2026-10-11T12:00:00.000Z',duty,now),/seven days/);
 const payload=makeQueuedPayload('occurrence','uuid-2','site','shift', {category:'patrol',narrative:'Patrol completed at the main gate.',eventAt}, '2026-10-19T12:00:00.000Z');
 assert.equal(payload.p_event_at,eventAt);
 assert.notEqual(payload.p_event_at,'2026-10-19T12:00:00.000Z');
});
