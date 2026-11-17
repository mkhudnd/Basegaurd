import test from 'node:test';
import assert from 'node:assert/strict';
import {composeObNarrative,emptyObFields,filterObRows} from './occurrence-ui.ts';

test('patrol fields are composed into original narrative without schema changes',()=>{
 const f={...emptyObFields(),location:'Main Gate',observation:'No issues found'};
 assert.equal(composeObNarrative('patrol',f),'Patrol location: Main Gate\nObservations: No issues found');
});
test('visitor requires a purpose and does not accept a blank form',()=>{
 assert.throws(()=>composeObNarrative('visitor',{...emptyObFields(),visitorName:'Lee'}),/purpose/);
 const narrative=composeObNarrative('visitor',{...emptyObFields(),visitorName:'Lee',visitPurpose:'Delivery',vehicle:'TEST-42'});
 assert.match(narrative,/Vehicle registration: TEST-42/);
});
test('inspection requires result; max length is enforced',()=>{
 assert.throws(()=>composeObNarrative('equipment',{...emptyObFields(),checkArea:'Store'}),/inspection result/i);
 assert.throws(()=>composeObNarrative('other',{...emptyObFields(),observation:'x'.repeat(3001)}),/3,000/);
});
test('occurrence filters exclude unrelated categories and show actual pending states',()=>{
 const rows=[{id:'a',category:'patrol',narrative:'main gate',eventAt:'2026-10-20T11:00:00Z',createdAt:'',receivedAt:null,status:'queued'},
 {id:'b',category:'visitor',narrative:'business visitor',eventAt:'2026-10-19T10:00:00Z',createdAt:'',receivedAt:'2026-10-19T10:01:00Z',status:'received'}];
 assert.deepEqual(filterObRows(rows,'gate','pending','all','2026-10-20').map(x=>x.id),['a']);
 assert.deepEqual(filterObRows(rows,'','received','all','2026-10-20').map(x=>x.id),['b']);
 assert.deepEqual(filterObRows(rows,'','today','all','2026-10-20').map(x=>x.id),['a']);
});
