import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';

// These sessions commit temporary records in the disposable replay container.
const container = 'baseguard-phase5b-review';
const run = 'recovery-' + randomUUID().slice(0, 8);
const site = randomUUID(), admin = randomUUID();
const subjects = Array.from({length:4},()=>({guard:randomUUID(),old:randomUUID(),next:randomUUID(),
  reconcile:randomUUID(),checkout:randomUUID()}));

function connection(label) {
  const name = run+'-'+label;
  const child = spawn('docker',['exec','-i','-e','PGAPPNAME='+name,container,'psql',
    '-XqAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']);
  let output = '', error = '';
  child.stdout.setEncoding('utf8').on('data',chunk=>{output+=chunk;});
  child.stderr.setEncoding('utf8').on('data',chunk=>{error+=chunk;});
  const done = new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',code=>resolve({code,output:output.trim(),error}));
  });
  return {name,get output(){return output;},done,
    write:sql=>child.stdin.write(sql+'\n'),
    end:(sql='')=>{if (!child.stdin.writableEnded) child.stdin.end(sql+'\n');}};
}
async function query(sql) {
  const session = connection('observer');
  session.end(sql);
  const result = await session.done;
  assert.equal(result.code,0,result.error);
  return result.output;
}
async function until(predicate) {
  for (let attempt=0;attempt<40;attempt++) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error('Timed out waiting for database concurrency assertion.');
}
const as = (actor,sql) => "set local role authenticated; set local request.jwt.claim.sub='"+actor+"'; "+sql;
const reconcile = subject=>as(admin,`select public.reconcile_overdue_duty('${subject.reconcile}','${site}',
  '${subject.old}',1,'Guard unavailable.');`);
const checkout = subject=>as(subject.guard,`select public.submit_guard_end_duty('${subject.checkout}',
  '${subject.old}',null,'Guard confirmed actual checkout','',array[]::uuid[],
  (select ended_at-interval '10 minutes' from public.shifts where id='${subject.old}'));`);
const activate = subject=>as(subject.guard,`select public.start_guard_duty('${subject.next}');`);
const transaction = sql => "begin; set local statement_timeout='12s'; "+sql+"\n";

await query(`insert into auth.users(id) values ${[admin,...subjects.map(s=>s.guard)].map(id=>`('${id}')`).join(',')};
  insert into public.profiles(id,display_name,role,is_active) values ('${admin}','Test administrator','admin',true),
    ${subjects.map(s=>`('${s.guard}','Test guard','guard',true)`).join(',')};
  insert into public.sites(id,code,name) values ('${site}','QA5D-${run.slice(-8)}','Recovery concurrency test');
  insert into public.site_assignments(user_id,site_id,role_at_site,valid_from)
    select id,'${site}',role,now()-interval '2 days' from public.profiles
    where id in (${[admin,...subjects.map(s=>s.guard)].map(id=>`'${id}'`).join(',')});
  insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status,post,checked_in_at) values
    ${subjects.flatMap(s=>[
      `('${s.old}','${site}','${s.guard}',now()-interval '4 hours',now()-interval '1 hour','active','Old post',now()-interval '4 hours')`,
      `('${s.next}','${site}','${s.guard}',now()-interval '30 minutes',now()+interval '1 hour','scheduled','Next post',null)`,
    ]).join(',')};`);

const samples = [];
async function race(label,firstSql,secondSql,expectedError) {
  const first = connection(label+'-first'), second = connection(label+'-second');
  try {
    first.write(transaction(firstSql)+'\\echo READY');
    await until(()=>first.output.includes('READY'));
    const started = performance.now();
    second.end(transaction(secondSql)+'commit;');
    await until(async()=>await query(`select exists(select 1 from pg_stat_activity
      where application_name='${second.name}' and wait_event_type='Lock' and wait_event='advisory');`)==='t');
    const waitSeen = performance.now();
    await delay(250);
    first.end('commit;');
    const [winner,follower] = await Promise.all([first.done,second.done]);
    assert.equal(winner.code,0,winner.error);
    if (expectedError) {
      assert.notEqual(follower.code,0);
      assert.match(follower.error,new RegExp('ERROR:\\s+'+expectedError+':'));
    } else {
      assert.equal(follower.code,0,follower.error);
    }
    const elapsed = Math.round(performance.now()-started);
    const observedWait = Math.round(waitSeen-started);
    samples.push(elapsed);
    console.log(`PASS: ${label} (${elapsed} ms including Docker/client startup; advisory wait observed by ${observedWait} ms)`);
    return [winner.output.replace(/\nREADY$/,''),follower.output];
  } finally {
    first.end('rollback;');
    second.end('rollback;');
    await Promise.allSettled([first.done,second.done]);
  }
}

await race('guard-before-admin',checkout(subjects[0]),reconcile(subjects[0]),'PT412');
await race('admin-before-guard',reconcile(subjects[1]),checkout(subjects[1]));
await race('admin-before-activation',reconcile(subjects[2]),activate(subjects[2]));
await query(transaction(checkout(subjects[2]))+'commit;');
const [receipt,retry] = await race('identical-reconciliation',reconcile(subjects[3]),reconcile(subjects[3]));
assert.deepEqual(JSON.parse(receipt),JSON.parse(retry));

for (const [index,subject] of subjects.entries()) {
  const expected = [index===0?0:1,index===1||index===2?1:0,index===0?1:0,index===2?1:0,
    index===3?0:1,index===0?0:1];
  const actual = await query(`select
    (select count(*) from public.audit_events where entity_ref='${subject.old}' and action='duty.reconciled'),
    (select count(*) from public.audit_events where entity_ref='${subject.old}' and action='duty.late_end_confirmed'),
    (select count(*) from public.audit_events where entity_ref='${subject.old}' and action='duty.checkout_confirmed'),
    (select count(*) from public.shifts where id='${subject.next}' and status='active' and checked_out_at is null),
    (select count(*) from public.shift_handovers where outgoing_shift_id='${subject.old}' and accepted_at is null),
    (select count(*) from private.scheduling_receipts where operation_id='${subject.reconcile}');`);
  assert.deepEqual(actual.split('|').map(Number),expected);
}
console.log(`PASS: exactly-once receipts, audits and handovers across all races; follower latency ${Math.min(...samples)}–${Math.max(...samples)} ms`);
