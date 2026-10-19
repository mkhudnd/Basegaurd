import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecord,validateIncident,simulateSync,acknowledge,closeIncident} from '../prototype/logic.mjs';
const time='2026-10-19T10:00:00.000Z';
const input={type:'Property Damage',severity:'Medium',description:'Damaged latch was found at demonstration entrance.',eventTime:time};
test('incident requires a factual narrative and type/severity',()=>{
 assert.ok(validateIncident({...input,description:'short'}).description);
 assert.ok(validateIncident({...input,type:''}).type);
 assert.deepEqual(validateIncident(input),{});
});
test('local report stays unsent before simulation',()=>{
 const record=createRecord('incident',{typeName:input.type,severity:input.severity,description:input.description},'local-id',time);
 assert.equal(record.delivery,'queued');assert.equal(record.serverRef,null);
});
test('sync assigns demo receipt only once and preserves local id',()=>{
 const rec=createRecord('incident',{typeName:input.type},'id-1',time);
 const first=simulateSync([rec],time,5);
 const second=simulateSync(first.records,time,first.nextNumber);
 assert.equal(first.records[0].serverRef,'DEMO-INC-2026-0006');
 assert.equal(second.records[0].serverRef,first.records[0].serverRef);
 assert.equal(first.records[0].id,'id-1');assert.equal(second.nextNumber,6);
});
test('cannot acknowledge unsent incidents or close before acknowledgement',()=>{
 const rec=createRecord('incident',{typeName:input.type},'id-2',time);
 assert.throws(()=>acknowledge(rec,time));
 const received=simulateSync([rec],time,5).records[0];
 assert.throws(()=>closeIncident(received,time,'Resolved after inspection'));
 const accepted=acknowledge(received,time);
 const closed=closeIncident(accepted,time,'Site team repaired the latch.');
 assert.equal(closed.delivery,'closed');assert.equal(closed.updates.length,2);
});
