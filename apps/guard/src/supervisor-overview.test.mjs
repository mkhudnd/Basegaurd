import assert from 'node:assert/strict';
import test from 'node:test';
import {countSupervisorOverview} from './supervisor-overview.ts';
const now='2026-10-21T12:00:00Z';
test('overview differentiates reported, acknowledged and closed incidents',()=>{
 const result=countSupervisorOverview([
  {status:'reported',received_at:now},{status:'acknowledged',received_at:now},
  {status:'resolved',received_at:now},{status:'closed',received_at:now}],[],now);
 assert.equal(result.awaiting,1);assert.equal(result.openCases,2);
});
test('duty counts are based on distinct guards and ignore finished shifts',()=>{
 const result=countSupervisorOverview([], [
  {id:'s1',guard_id:'a',status:'active',ended_at:null,presence_status:'on_duty'},
  {id:'s2',guard_id:'a',status:'active',ended_at:null,presence_status:'on_duty'},
  {id:'s3',guard_id:'b',status:'active',ended_at:null,presence_status:'on_break'},
  {id:'s4',guard_id:'c',status:'completed',ended_at:null,presence_status:'on_duty'},
  {id:'s5',guard_id:'d',status:'active',ended_at:'2026-10-20T12:00:00Z',presence_status:'on_duty'},
 ],now);
 assert.equal(result.onDuty,1);assert.equal(result.onBreak,1);assert.equal(result.activeShifts.length,3);
});
test('an empty server response produces no fabricated totals',()=>{
 const result=countSupervisorOverview([],[],now);
 assert.deepEqual({onDuty:result.onDuty,onBreak:result.onBreak,awaiting:result.awaiting,openCases:result.openCases},
  {onDuty:0,onBreak:0,awaiting:0,openCases:0});
});
