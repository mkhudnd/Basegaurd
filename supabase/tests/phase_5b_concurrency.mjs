import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const container = 'baseguard-phase5b-review';
const prefix = '5B-' + randomUUID().slice(0, 8).toUpperCase();

// Never run concurrency fixtures on the existing local Baseguard stack.
function connection(name) {
  const process = spawn('docker', ['exec', '-e', 'PGAPPNAME=' + name, '-i', container, 'psql',
    '-XqAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']);
  let output = '';
  let error = '';
  process.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
  process.stderr.setEncoding('utf8').on('data', chunk => { error += chunk; });
  const done = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('close', code => resolve({code, output: output.trim(), error}));
  });
  return {
    write: sql => process.stdin.write(sql + '\n'),
    end: (sql = '') => { if (!process.stdin.writableEnded) process.stdin.end(sql + '\n'); },
    output: () => output,
    done,
  };
}

async function query(sql) {
  const client = connection('phase5b-observer');
  client.end(sql);
  const result = await client.done;
  assert.equal(result.code, 0, result.error);
  return result.output;
}

async function until(predicate, label) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await predicate()) return;
    await delay(75);
  }
  throw new Error('Timed out waiting for ' + label);
}

async function race(name, firstSql, secondSql, code, redacted = false) {
  const first = connection('phase5b-first');
  const secondName = 'phase5b-' + name;
  const second = connection(secondName);
  try {
    first.write("begin; set local statement_timeout='15s'; " + firstSql + '\n\\echo READY');
    await until(() => first.output().includes('READY'), name + ' first write');
    second.end("begin; set local statement_timeout='15s'; " + secondSql + '\ncommit;');
    await until(async () => (await query("select exists(select 1 from pg_stat_activity where application_name='" +
      secondName + "' and wait_event_type='Lock');")) === 't', name + ' lock wait');
    first.end('commit;');
    const [winner, loser] = await Promise.all([first.done, second.done]);
    assert.equal(winner.code, 0, winner.error);
    if (!code) {
      assert.equal(loser.code, 0, loser.error);
      console.log('PASS: ' + name);
      return;
    }
    assert.notEqual(loser.code, 0);
    assert.match(loser.error, new RegExp('ERROR:\\s+' + code + ':'));
    if (redacted) {
      assert.match(loser.error, /Guard is unavailable for this interval/);
      assert.doesNotMatch(loser.error, /DETAIL:|conflicts with existing key|Private fixture site/);
    }
    console.log('PASS: ' + name);
  } finally {
    first.end('rollback;');
    second.end('rollback;');
    await Promise.allSettled([first.done, second.done]);
  }
}

const admin = randomUUID(), leftManager = randomUUID(), rightManager = randomUUID();
const guards = Array.from({length: 8}, () => randomUUID());
const users = [admin, leftManager, rightManager, ...guards];
const role = actor => "set local role authenticated; set local request.jwt.claim.sub='" + actor + "';";
const quoted = value => "'" + value + "'";
const put = values => values.map(row => '(' + row.map(quoted).join(',') + ')').join(',');
await query("insert into auth.users(id) values " + put(users.map(id => [id])) + ";\n" +
  "insert into public.profiles(id,display_name,role,is_active) values " +
  put(users.map((id,index) => [id, 'Fixture ' + index, index === 0 ? 'admin' : index < 3 ? 'supervisor' : 'guard', 'true'])) + ';');

async function site(suffix, manager, capacity = 1) {
  const siteId = randomUUID(), postId = randomUUID();
  await query("insert into public.sites(id,code,name) values " + put([[siteId,prefix+'-'+suffix,'Private fixture site']]) +
    "; insert into public.security_posts(id,site_id,code,name) values " + put([[postId,siteId,'GATE','Fixture gate']]) +
    "; insert into public.site_assignments(user_id,site_id,role_at_site) values " +
    put([[admin,siteId,'admin'],[manager,siteId,'supervisor'],...guards.map(id=>[id,siteId,'guard'])]) +
    "; begin; " + role(admin) + "select public.save_post_booking_capacity('" + randomUUID() + "','" +
    siteId + "','" + postId + "',0," + capacity + "); commit;");
  return {id:siteId,post:postId,manager};
}
const left = await site('LEFT',leftManager,2);
const right = await site('RIGHT',rightManager);
const siteBlock = await site('SITE',leftManager);
const postBlock = await site('POST',leftManager);
const guardBlock = await site('GUARD',leftManager);
const assignmentBlock = await site('MEMBER',leftManager);
const start = "date_trunc('day',now())+interval '5 days'";
const end = start + "+interval '4 hours'";
const book = (s, guard, id = randomUUID()) => role(s.manager) +
  "select public.save_scheduled_shift('" + id + "','" + s.id + "',null,0,'" + guard +
  "','" + s.post + "'," + start + "," + end + ",'custom');";
const siteOff = s => role(admin) + "select public.update_managed_site('" + s.id + "',1,'Fixture site',false);";
const postOff = s => role(admin) + "select public.update_security_post('" + s.id + "','" + s.post + "',1,'GATE','Fixture gate',false,null);";
const guardOff = guard => "update public.profiles set is_active=false where id='" + guard + "';";
const expire = (s,guard) => "update public.site_assignments set valid_to=" + start +
  " where site_id='" + s.id + "' and user_id='" + guard + "';";

await race('cross-site-guard-exclusion',book(left,guards[0]),book(right,guards[0]),'PT409',true);
await race('post-last-slot',book(left,guards[1]),book(left,guards[2]),'PT409');
await race('site-booking-first',book(siteBlock,guards[2]),siteOff(siteBlock),'23514');
await race('post-deactivation-first',postOff(postBlock),book(postBlock,guards[3]),'PT422');
await race('account-booking-first',book(guardBlock,guards[3]),guardOff(guards[3]),'PT423');
await race('assignment-expiry-first',expire(assignmentBlock,guards[4]),book(assignmentBlock,guards[4]),'PT422');

assert.equal(await query("select capacity from private.post_booking_capacity where post_id='" + left.post + "';"),'2');
const reduction = await site('REDUCE',leftManager,2);
await query("begin; " + book(reduction,guards[4]) + " commit;");
await race('capacity-reduction-after-booking',book(reduction,guards[5]),role(admin) +
  "select public.save_post_booking_capacity('" + randomUUID() + "','" + reduction.id +
  "','" + reduction.post + "',1,1);",'PT423');

const adjacentSite = await site('ACTIVE',leftManager);
const old = randomUUID(), due = randomUUID(), actor = guards[7];
await query("insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status) values " +
  "('" + old + "','" + adjacentSite.id + "','" + actor + "',now()-interval '2 hours',now()-interval '1 hour','scheduled')," +
  "('" + due + "','" + adjacentSite.id + "','" + actor + "',now()-interval '1 hour',now()+interval '1 hour','scheduled');" +
  " update public.shifts set status='active' where id='" + old + "';");
await race('overdue-active-blocks-waiting-activation', "select private.scheduling_lock();", role(actor) +
  "select public.start_guard_duty('" + due + "');", 'P0001');
assert.equal(await query("select count(*) from public.shifts where guard_id='" + actor + "' and status='active';"),'1');
console.log('PASS: exactly one active shift after the blocked overdue activation');
await race('end-duty-releases-guard-for-next-activation', role(actor) +
  "select public.submit_guard_end_duty('" + randomUUID() + "','" + old +
  "',null,'Fixture checkout',null,'{}',now()-interval '70 minutes');", role(actor) +
  "select public.start_guard_duty('" + due + "');", null);
assert.equal(await query("select id from public.shifts where guard_id='" + actor + "' and status='active';"),due);
