import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getEndDutyStatus} from './end-duty-state.ts';
import {enqueueHandover,replayHandovers} from './handover-outbox.ts';
import {validateIncident} from './incident-domain.ts';

const shift = 'shift-a';
const endDuty = (state, payload = {p_id: 'op-a', p_shift_id: shift, p_ended_at: '2026-11-20T04:00:00.000Z'}) => ({
  kind: 'submit', slot: shift, state, payload: JSON.stringify(payload),
});

test('no active shift or no outgoing operation has no End Duty status', () => {
  assert.equal(getEndDutyStatus([], shift), 'none');
  assert.equal(getEndDutyStatus([endDuty('received')], null), 'none');
  assert.equal(getEndDutyStatus([endDuty('received')], 'different-shift'), 'none');
  assert.equal(getEndDutyStatus([{...endDuty('received'), kind: 'receive'}], shift), 'none');
});

test('only a timestamped end-duty submission is treated as ending the shift', () => {
  assert.equal(getEndDutyStatus([endDuty('queued')], shift), 'queued');
  assert.equal(getEndDutyStatus([endDuty('sending')], shift), 'sending');
  assert.equal(getEndDutyStatus([endDuty('failed')], shift), 'failed');
  assert.equal(getEndDutyStatus([endDuty('received')], shift), 'received');
});

test('older outgoing handovers are not mistaken for completed End Duty', () => {
  assert.equal(getEndDutyStatus([endDuty('received', {p_shift_id: shift})], shift), 'legacy-handover');
  assert.equal(getEndDutyStatus([endDuty('received', {p_ended_at: 'invalid'})], shift), 'legacy-handover');
  assert.equal(getEndDutyStatus([{...endDuty('queued'), payload: '{broken'}], shift), 'legacy-handover');
});

test('restarting the replay worker preserves the actor, checkout time and UUID through a lost receipt', async () => {
  const rows=new Map();
  // The adapter instances share persisted rows, as a reopened SQLCipher DB does.
  function reopen() {
    return {
      async runAsync(sql,...args) {
        if (sql.startsWith('INSERT')) {
          const [actor,id,kind,slot,payload]=args;
          const key=JSON.stringify([actor,kind,slot]);
          if (!rows.has(key)) rows.set(key,{actor,id,kind,slot,payload,state:'queued'});
          return;
        }
        const [actor,kind,id]=args.slice(-3);
        const row=[...rows.values()].find(entry=>entry.actor===actor&&entry.kind===kind&&entry.id===id);
        row.state=sql.includes("state='received'")?'received':'failed';
      },
      async getAllAsync(sql,actor,kind,slot) {
        return [...rows.values()].filter(row=>row.actor===actor&&
          (sql.startsWith('SELECT payload')?row.kind===kind&&row.slot===slot:row.state!=='received'));
      },
    };
  }
  const payload={p_id:'recovery-a',p_shift_id:shift,p_incoming_shift_id:null,p_notes:'Actual duty ended earlier',
    p_equipment:'',p_incident_ids:[],p_ended_at:'2026-11-20T03:43:00.000Z'};
  await enqueueHandover(reopen(),'guard-a','submit',shift,payload);
  assert.equal(getEndDutyStatus([...rows.values()],shift),'queued');
  assert.deepEqual(await replayHandovers(reopen(),'guard-b',()=>assert.fail('Wrong actor received cached work.')),{sent:0,failed:0});
  const sent=[];
  assert.deepEqual(await replayHandovers(reopen(),'guard-a',async op=>{
    sent.push(op.payload);
    throw new Error('Connection reset before receipt.');
  }),{sent:0,failed:1});
  assert.equal(getEndDutyStatus([...rows.values()],shift),'failed');
  assert.deepEqual(await replayHandovers(reopen(),'guard-a',async op=>{
    sent.push(op.payload);
    return {id:op.id,received_at:'2026-11-20T06:00:00Z'};
  }),{sent:1,failed:0});
  assert.deepEqual(sent,[JSON.stringify(payload),JSON.stringify(payload)]);
  assert.equal(rows.size,1);
  assert.equal(getEndDutyStatus([...rows.values()],shift),'received');
});

test('overdue cached assignment is wired to recovery while an expired window confers no incident authority', () => {
  const src=name=>readFileSync(new URL(name,import.meta.url),'utf8');
  assert.match(src('./offline.ts'),/cached_duty WHERE guard_id = \?',guardId/);
  assert.match(src('./guard-service.ts'),/recovery=await cachedDuty\(guardId,'recovery'\)/);
  assert.match(src('../App.tsx'),/const endDutyTarget=duty\?\?recoveryDuty/);
  assert.match(src('../App.tsx'),/canReport=\{!!duty&&!endDutyRecorded\}/);
  assert.match(src('../App.tsx'),/hasDuty=\{!!duty&&!endDutyRecorded\}/);
  const expired={started_at:'2026-11-20T02:00:00Z',ended_at:'2026-11-20T04:00:00Z',fetched_at:'2026-11-20T02:00:00Z'};
  assert.match(validateIncident({category:'other',severity:'low',eventAt:'2026-11-20T03:00:00Z',
    narrative:'Observation during the previous duty.',actions:''},expired,Date.parse('2026-11-20T05:00:00Z')),/active duty assignment/);
});
