import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// The fixtures commit so parallel connections can see them. Restrict this
// runner to the disposable, network-isolated container from the replay guide.
const container = process.argv.includes('--phase5b') ? 'baseguard-phase5b-review' : 'baseguard-phase4b-review';
const runId = randomUUID().slice(0, 8).toUpperCase();
const admin = randomUUID();
const guard = randomUUID();
const activationGuard = randomUUID();
const adminRole = `set local role authenticated; set local request.jwt.claim.sub='${admin}';`;
const guardRole = `set local role authenticated; set local request.jwt.claim.sub='${guard}';`;

function session(name) {
  const process = spawn('docker', [
    'exec', '-e', `PGAPPNAME=${name}`, '-i', container, 'psql',
    '-XqAt', '-U', 'supabase_admin', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  ]);
  let stdout = '';
  let stderr = '';
  process.stdout.setEncoding('utf8').on('data', data => { stdout += data; });
  process.stderr.setEncoding('utf8').on('data', data => { stderr += data; });
  const completed = new Promise((resolve, reject) => {
    process.on('error', reject);
    process.on('close', code => resolve({code, stdout: stdout.trim(), stderr}));
  });
  return {
    write: text => process.stdin.write(text + '\n'),
    end: text => process.stdin.end(text ? text + '\n' : undefined),
    output: () => stdout,
    completed,
  };
}

async function query(sql, name = 'phase4b-observer') {
  const connection = session(name);
  connection.end(sql);
  const result = await connection.completed;
  assert.equal(result.code, 0, result.stderr);
  return result.stdout;
}

async function waitFor(check, description) {
  for (let i = 0; i < 30; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + description);
}

async function race(name, firstSql, secondSql, expectedState) {
  const first = session('phase4b-winner');
  const secondName = 'phase4b-waiter-' + name;
  const second = session(secondName);
  try {
    first.write(`begin; set local statement_timeout='15s'; ${firstSql}\n\\echo LOCK_HELD`);
    await waitFor(() => first.output().includes('LOCK_HELD'), 'first writer');
    second.end(`begin; set local statement_timeout='15s'; ${secondSql}\ncommit;`);
    await waitFor(
      async () => await query(`select exists(select 1 from pg_stat_activity where application_name='${secondName}' and wait_event_type='Lock');`) === 't',
      'second writer to block',
    );
    first.end('commit;');
    const [winner, loser] = await Promise.all([first.completed, second.completed]);
    assert.equal(winner.code, 0, winner.stderr);
    assert.notEqual(loser.code, 0);
    assert.match(loser.stderr, new RegExp(`ERROR:\\s+${expectedState}:`));
    console.log('PASS: ' + name);
  } finally {
    first.end();
    second.end();
    await Promise.allSettled([first.completed, second.completed]);
  }
}

await query(`
  insert into auth.users(id) values ('${admin}'),('${guard}'),('${activationGuard}');
  insert into public.profiles(id,display_name,role,is_active)
  values ('${admin}','Concurrency admin','admin',true), ('${guard}','Concurrency guard','guard',true),
    ('${activationGuard}','Activation guard','guard',true);
`);
async function site(suffix) {
  return query(`begin; ${adminRole}
    select public.create_managed_site('4B-${runId}-${suffix}','Concurrency site')->>'id'; commit;`);
}
const geography = await site('G');
const rosterFirst = await site('R');
const deactivationFirst = await site('D');
const activation = await site('A');
const incidentFirst = await site('I');
const deactivationBeforeIncident = await site('J');
const geographySave = (revision, details) =>
  `select public.save_site_geography('${geography}',${revision},'${details}',null,null);`;
const deactivate = id => `select public.update_managed_site('${id}',1,'Concurrency site',false);`;
const insertShift = (siteId, shiftId = randomUUID(), scheduledGuard = guard) => `
  insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status)
  values ('${shiftId}','${siteId}','${scheduledGuard}',now()-interval '1 minute',now()+interval '1 hour','scheduled');`;

await race('geography-first-insert', adminRole + geographySave(0, 'First writer'),
  adminRole + geographySave(0, 'Second writer'), 'PT409');
await race('geography-concurrent-edit', adminRole + geographySave(1, 'Winner'),
  adminRole + geographySave(1, 'Stale edit'), 'PT409');
assert.equal(await query(`select revision || ':' || details from public.site_geography where site_id='${geography}';`), '2:Winner');

await race('schedule-before-deactivation', insertShift(rosterFirst), adminRole + deactivate(rosterFirst), '23514');
await race('deactivation-before-schedule', adminRole + deactivate(deactivationFirst), insertShift(deactivationFirst), '23514');
const shiftId = randomUUID();
await query(`insert into public.site_assignments(user_id,site_id,role_at_site) values ('${activationGuard}','${activation}','guard');
  ${insertShift(activation, shiftId, activationGuard)}`);
await race('guard-activation-before-deactivation',
  `set local role authenticated; set local request.jwt.claim.sub='${activationGuard}';
   select public.start_guard_duty('${shiftId}');`, adminRole + deactivate(activation), '23514');

async function lateReport(siteId) {
  const shift = randomUUID();
  const incident = randomUUID();
  await query(`insert into public.site_assignments(user_id,site_id,role_at_site) values ('${guard}','${siteId}','guard');
    insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status)
    values ('${shift}','${siteId}','${guard}',now()-interval '2 hours',now()-interval '1 hour','completed');`);
  return guardRole + `select public.submit_incident('${incident}','${siteId}','${shift}',
    'other','low','Late fixture report',now()-interval '90 minutes');`;
}
await race('incident-before-deactivation', await lateReport(incidentFirst),
  adminRole + deactivate(incidentFirst), '23514');
await race('deactivation-before-incident', adminRole + deactivate(deactivationBeforeIncident),
  await lateReport(deactivationBeforeIncident), '23514');

assert.equal(await query(`
  select (select is_active from public.sites where id='${rosterFirst}')
    and not (select is_active from public.sites where id='${deactivationFirst}')
    and not exists(select 1 from public.shifts where site_id='${deactivationFirst}')
    and exists(select 1 from public.shifts where id='${shiftId}' and status='active')
    and exists(select 1 from public.incidents where site_id='${incidentFirst}')
    and not exists(select 1 from public.incidents where site_id='${deactivationBeforeIncident}')
    and (select count(*)=2 from public.audit_events where site_id='${geography}' and action='site.geography_saved');
`), 't');
console.log('PASS: concurrent outcomes and audit counts');
