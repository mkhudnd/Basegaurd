import test from 'node:test';
import assert from 'node:assert/strict';
import {asHarareInstant,canFollow,coverageValue,editableInstant,occursOnDay,
  requestOperation,rosterActions,rosterError,rosterRange,rosterReceipt,rosterState} from './roster-domain.ts';

const overnight={id:'night',guard_id:'ada',security_post_id:'gate',status:'scheduled',
  started_at:'2026-11-25T18:00:00Z',ended_at:'2026-11-26T02:00:00Z',
  scheduled_start_at:'2026-11-25T18:00:00Z',scheduled_end_at:'2026-11-26T02:00:00Z'};
const now=(value)=>Date.parse(value);
test('Harare weeks start Monday and preserve overnight day membership',()=>{
  const week=rosterRange('2026-11-25','Week');
  assert.equal(week.dates[0],'2026-11-23');
  assert.equal(week.start,'2026-11-22T22:00:00.000Z');
  assert.equal(week.end,'2026-11-29T22:00:00.000Z');
  assert.deepEqual(rosterRange('2026-11-25','List'),week);
  assert.equal(rosterRange('2026-11-26','Day').dates.length,1);
  assert.ok(occursOnDay(overnight,'2026-11-25'));
  assert.ok(occursOnDay(overnight,'2026-11-26'));
  assert.equal(occursOnDay({...overnight,scheduled_end_at:'2026-11-25T22:00:00Z'},'2026-11-26'),false);
  assert.equal(asHarareInstant('2026-11-26T00:00'),'2026-11-25T22:00:00.000Z');
  assert.equal(asHarareInstant('2026-02-30T00:00'),null);
  assert.equal(editableInstant('2026-11-26T04:00','2026-11-26T02:00:12.123456Z'),'2026-11-26T02:00:12.123456Z');
});
test('future, due, historical and overdue states are separate',()=>{
  assert.equal(rosterState(overnight,now('2026-11-25T17:59Z')),'Upcoming');
  assert.equal(rosterState(overnight,now('2026-11-25T18:00Z')),'Awaiting check-in');
  assert.equal(rosterState(overnight,now('2026-11-26T02:00Z')),'Missed check-in');
  assert.equal(rosterState({...overnight,status:'active',presence_status:'on_break'},now('2026-11-26T00:00Z')),'On break');
  assert.equal(rosterState({...overnight,status:'active'},now('2026-11-26T02:00Z')),'Overdue active duty');
  assert.equal(rosterState({...overnight,status:'completed'},now('2026-11-26T02:00Z')),'Completed');
  assert.equal(rosterState({...overnight,status:'cancelled'},now('2026-11-26T02:00Z')),'Cancelled');
});
test('protected and activated records have no ordinary edit action',()=>{
  assert.deepEqual(rosterActions(overnight,0,true),{edit:false,cancel:false});
  assert.deepEqual(rosterActions({...overnight,status:'active'},0,false),{edit:false,cancel:false});
  assert.deepEqual(rosterActions(overnight,now('2026-11-26T02:00Z'),false),{edit:false,cancel:true});
  const next={...overnight,id:'next',guard_id:'b',started_at:overnight.ended_at};
  assert.equal(canFollow(next,'night','gate','ada',overnight.ended_at),true);
  assert.equal(canFollow({...next,security_post_id:null},'night','gate','ada',overnight.ended_at),false);
  assert.equal(canFollow({...next,guard_id:'ada'},'night','gate','ada',overnight.ended_at),false);
});
test('coverage preserves real zero and does not present missing data as zero',()=>{
  const row={required_staffing:0,scheduled_personnel:0,confirmed_attendance:0,actual_attendance_available:false,legacy_unmapped:true};
  assert.equal(coverageValue(row,'required_staffing'),0);
  assert.equal(coverageValue(row,'planned_gap'),undefined);
  assert.equal(coverageValue(row,'confirmed_attendance'),undefined);
  assert.equal(coverageValue(row,'scheduled_personnel'),undefined);
});
test('normalised retry reuses UUID and rejects unrelated or unconfirmed receipts',()=>{
  const ids=new Map();
  let number=0;
  const make=()=>String(++number);
  assert.equal(requestOperation(ids,'save_scheduled_shift',{start:'a',end:'b'},make).id,'1');
  assert.equal(requestOperation(ids,'save_scheduled_shift',{end:'b',start:'a'},make).id,'1');
  assert.equal(requestOperation(ids,'save_scheduled_shift',{end:'c',start:'a'},make).id,'2');
  const id='441e11e1-3c45-473a-a3ec-8dced399a8c9';
  const receipt={id,operation_id:'1',revision:2,status:'scheduled',received_at:'2026-11-25T18:00:00Z'};
  assert.equal(rosterReceipt(receipt,'1',id,2,'scheduled'),receipt);
  assert.throws(()=>rosterReceipt(receipt,'2',id,2,'scheduled'));
  assert.throws(()=>rosterReceipt(receipt,'1',id,3,'scheduled'));
  assert.throws(()=>rosterReceipt({...receipt,received_at:'unknown'},'1',id,2,'scheduled'));
  assert.equal(rosterError({code:'PT409',message:'Other site, sensitive detail'}),'Guard is unavailable for this interval.');
  assert.match(rosterError({code:'PT412'}),/Reload and review/);
});
