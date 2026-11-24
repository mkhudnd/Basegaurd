import assert from 'node:assert/strict';
import test from 'node:test';
import {canTransition,compareSeverity,harareDayRange,safeSearchTerm,validateAcknowledgementReceipt,validateResponseReceipt} from './incident-domain.ts';

test('incident lifecycle permits only supported forward actions',()=>{
  assert.equal(canTransition('reported','acknowledge'),true);
  assert.equal(canTransition('reported','resolve'),false);
  assert.equal(canTransition('acknowledged','progress'),true);
  assert.equal(canTransition('in_progress','resolve'),true);
  assert.equal(canTransition('resolved','close'),true);
  assert.equal(canTransition('closed','progress'),false);
});

test('search input is bounded and safe for PostgREST or filters',()=>{
  assert.equal(safeSearchTerm('  fire,(gate).%  '),'fire gate');
  assert.equal(safeSearchTerm('x'.repeat(200)).length,120);
});

test('Harare date filter creates an exact local-day UTC range',()=>{
  assert.deepEqual(harareDayRange('2026-11-24'),{
    start:'2026-11-23T22:00:00.000Z',end:'2026-11-24T22:00:00.000Z',
  });
  assert.equal(harareDayRange('not-a-date'),null);
});

test('severity sorting puts critical incidents first',()=>{
  assert.ok(compareSeverity('low','critical')>0);
  assert.ok(compareSeverity('critical','low')<0);
});

test('failed or mismatched acknowledgement is never accepted as success',()=>{
  assert.throws(()=>validateAcknowledgementReceipt('incident-a',null),/Invalid/);
  assert.throws(()=>validateAcknowledgementReceipt('incident-a',{id:'incident-b',status:'acknowledged'}),/Invalid/);
  assert.throws(()=>validateAcknowledgementReceipt('incident-a',{id:'incident-a',status:'reported'}),/Invalid/);
  assert.equal(validateAcknowledgementReceipt('incident-a',{id:'incident-a',status:'acknowledged'}),'acknowledged');
});

test('response transitions require the matching id and server timestamp',()=>{
  assert.throws(()=>validateResponseReceipt('update-a',{id:'update-a'}),/Invalid/);
  assert.throws(()=>validateResponseReceipt('update-a',{id:'update-b',created_at:new Date().toISOString()}),/Invalid/);
  assert.doesNotThrow(()=>validateResponseReceipt('update-a',{id:'update-a',created_at:new Date().toISOString()}));
});
