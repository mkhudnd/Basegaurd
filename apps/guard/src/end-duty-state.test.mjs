import test from 'node:test';
import assert from 'node:assert/strict';
import {getEndDutyStatus} from './end-duty-state.ts';

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
