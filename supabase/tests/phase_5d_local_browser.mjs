// Real Chrome + loopback Supabase. Fictional QA5D records are retained for review.
// Set BASEGUARD_PLAYWRIGHT to the installed Playwright module entry point.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseEnv} from 'node:util';

const local = 'http://127.0.0.1:54321';
const preview = 'http://127.0.0.1:5186';
const env = parseEnv(readFileSync(new URL('../../apps/supervisor/.env.local',import.meta.url),'utf8'));
assert.equal(env.VITE_SUPABASE_URL?.replace(/\/$/,''),local,'Use only the local Baseguard Supabase stack.');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.ok(key && !key.startsWith('sb_secret_'),'Local publishable key required.');
if (key.split('.').length===3) {
  assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role,'anon');
}
assert.ok(process.env.BASEGUARD_PLAYWRIGHT,'Set the external Playwright module path.');
const playwright = await import(pathToFileURL(process.env.BASEGUARD_PLAYWRIGHT));
const artifacts=process.env.BASEGUARD_SCREENSHOTS;
if (artifacts) mkdirSync(artifacts,{recursive:true});
const code='QA5D-'+randomBytes(4).toString('hex').toUpperCase();
const site=randomUUID(), other=randomUUID(), post=randomUUID(), duty=randomUUID();
const name=code+' Review Site';

function sql(input) {
  const result=spawnSync('docker',['exec','-i','supabase_db_Baseguard','psql',
    '-XqAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'});
  assert.equal(result.status,0,'Local fixture or committed-state check failed.');
  return result.stdout.trim();
}
async function api(path,body,token) {
  const response=await fetch(local+path,{method:'POST',redirect:'error',
    headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    body:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
}
async function account(role) {
  const email=code.toLowerCase()+'-'+role+'@baseguard.test';
  const password=randomBytes(24).toString('base64url')+'1!aA';
  const result=await api('/auth/v1/signup',{email,password});
  assert.ok(result.status<300,'Fictional local signup failed.');
  const id=result.data.user?.id??result.data.id;
  assert.match(id??'',/^[0-9a-f-]{36}$/);
  sql(`update auth.users set email_confirmed_at=coalesce(email_confirmed_at,now()) where id='${id}' and email='${email}';
    insert into public.profiles(id,display_name,role,is_active) values ('${id}','${code} ${role}','${role}',true);`);
  return {id,email,password};
}
function rpc(actor,name,body) {
  return api('/rest/v1/rpc/'+name,body,actor?.token);
}
async function session(account) {
  const response=await api('/auth/v1/token?grant_type=password',{email:account.email,password:account.password});
  assert.equal(response.status,200,'Local fixture password grant failed.');
  return {...account,token:response.data.access_token};
}
const print=message=>console.log('PASS: '+message);
const screenshot=async(page,description)=>{
  if(artifacts) await page.screenshot({path:join(artifacts,code+'-'+description+'.png'),fullPage:true});
};
const rosterTable=page=>page.getByRole('region',{name:name+' roster activity'}).getByRole('table');
const confirmReason='Fictional local reconciliation. Guard is unavailable.';
const guardCheckout='Fictional guard-confirmed checkout evidence.';
const harareFields=new Intl.DateTimeFormat('sv-SE',{timeZone:'Africa/Harare',year:'numeric',month:'2-digit',
  day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const datetime=offset=>harareFields.format(new Date(Date.now()+offset)).replace(' ','T');

const browser=await playwright.chromium.launch({channel:'chrome',headless:true});
try {
  const admin=await account('admin'), supervisor=await account('supervisor'), guard=await account('guard');
  const verifiedGuard=await session(guard), verifiedSupervisor=await session(supervisor);
  sql(`insert into public.sites(id,code,name) values ('${site}','${code}','${name}'),
    ('${other}','${code}-OTHER','${code} Other Site');
    insert into public.site_assignments(user_id,site_id,role_at_site,valid_from)
      select id,'${site}',role,now()-interval '2 days' from public.profiles where id in ('${admin.id}','${supervisor.id}','${guard.id}');
    insert into public.security_posts(id,site_id,code,name) values ('${post}','${site}','GATE','Fictional Gate');
    insert into private.post_booking_capacity(site_id,post_id,capacity) values ('${site}','${post}',1);
    insert into private.post_staffing_requirements(site_id,post_id,period,required_count)
      values ('${site}','${post}',tstzrange(date_trunc('day',now() at time zone 'Africa/Harare')
        at time zone 'Africa/Harare',(date_trunc('day',now() at time zone 'Africa/Harare')
        at time zone 'Africa/Harare')+interval '24 hours','[)'),1);
    insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status,post,checked_in_at)
      values ('${duty}','${site}','${guard.id}',now()-interval '3 hours',now()-interval '1 hour',
        'active','Original fictional post',now()-interval '3 hours');`);
  console.log('Browser fixture site: '+code);
  assert.equal((await rpc(verifiedSupervisor,'get_operations_schedule',{p_site_id:other})).status,403);
  assert.equal((await rpc(verifiedSupervisor,'reconcile_overdue_duty',{p_site_id:site,p_shift_id:duty,
    p_operation_id:randomUUID(),p_expected_revision:1,p_reason:confirmReason})).status,403);

  async function pageFor(account,viewport={width:1440,height:1000}) {
    const context=await browser.newContext({viewport});
    // The only operational responses come from the real local Supabase endpoints.
    await context.route('**/*',route=>{
      const origin=new URL(route.request().url()).origin;
      return origin===local||origin===preview ? route.continue() : route.abort();
    });
    const page=await context.newPage();
    await page.goto(preview);
    await page.getByLabel('Work email').fill(account.email);
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('heading',{name:'Scheduling and coverage'}).waitFor();
    await page.getByRole('region',{name:name+' scheduling'}).waitFor();
    return page;
  }
  async function openRosterRow(page,state) {
    await rosterTable(page).getByRole('row').filter({hasText:state})
      .getByRole('button',{name:'Open roster record'}).click();
    const details=page.getByRole('dialog',{name:'Shift details'});
    await details.getByText(state,{exact:true}).waitFor();
    return details;
  }
  async function loseFirstResponse(page,endpoint,assertCommitted) {
    const received=[];
    await page.route(local+'/rest/v1/rpc/'+endpoint,async route=>{
      if (route.request().method()!=='POST') return route.continue();
      const body=route.request().postDataJSON();
      const response=await route.fetch({maxRetries:0});
      const result=await response.json();
      received.push({body,result,status:response.status()});
      if (received.length===1) {
        // Observe the committed write from a different DB connection before
        // breaking delivery to the app. A fabricated response is never used.
        try { assertCommitted(result); }
        catch (error) { received[0].failure=error; }
        return route.abort('connectionreset');
      }
      return route.fulfill({response});
    });
    return received;
  }
  function sameRetry(calls) {
    assert.equal(calls.length,2);
    if (calls[0].failure) throw calls[0].failure;
    assert.deepEqual(calls[0].body,calls[1].body);
    assert.deepEqual(calls[0].result,calls[1].result);
    assert.equal(calls[0].status,200);
    assert.equal(calls[1].status,200);
  }

  const supervisorPage=await pageFor(supervisor,{width:1024,height:920});
  await rosterTable(supervisorPage).getByText('Overdue active duty',{exact:true}).waitFor();
  await screenshot(supervisorPage,'supervisor-1024');
  const supervised=await openRosterRow(supervisorPage,'Overdue active duty');
  assert.equal(await supervised.getByRole('button',{name:'Reconcile overdue duty'}).count(),0);
  print('Authenticated supervisor sees authorized overdue data, cannot reconcile, and cannot read the other site');

  const adminPage=await pageFor(admin);
  await screenshot(adminPage,'overview-1440');
  const details=await openRosterRow(adminPage,'Overdue active duty');
  await details.getByRole('button',{name:'Reconcile overdue duty'}).click();
  const reconcileDialog=adminPage.getByRole('dialog',{name:'Reconcile overdue duty'});
  await reconcileDialog.getByLabel('Reason').fill(confirmReason);
  const reconciliation=reconcileDialog.getByRole('button',{name:'Reconcile duty',exact:true});
  assert.equal(await reconciliation.isEnabled(),false);
  await reconcileDialog.getByRole('checkbox').check();
  const reconcileCalls=await loseFirstResponse(adminPage,'reconcile_overdue_duty',result=>{
    assert.equal(result.id,duty);
    assert.equal(sql(`select status||'|'||(checked_out_at is null)::text from public.shifts where id='${duty}';`),'completed|true');
  });
  await reconciliation.click();
  await reconcileDialog.getByRole('alert').waitFor();
  assert.equal(await reconcileDialog.getByLabel('Reason').inputValue(),confirmReason);
  assert.equal(await adminPage.getByText('Administrative reconciliation confirmed by the server.').count(),0);
  await reconciliation.click();
  await details.getByRole('heading',{name:'Duty reconciliation history'}).waitFor();
  sameRetry(reconcileCalls);
  assert.equal(sql(`select
    (select count(*) from public.shifts where id='${duty}'),
    (select count(*) from public.audit_events where action='duty.reconciled' and entity_ref='${duty}'),
    (select count(*) from private.scheduling_receipts where operation_id='${reconcileCalls[0].body.p_operation_id}'),
    (select count(*) from public.shift_handovers where outgoing_shift_id='${duty}');`),'1|1|1|0');
  await screenshot(adminPage,'reconciliation-1440');
  print('Real browser reconciliation lost its committed response; exact retry returned the original receipt and one audit, with no fabricated checkout or handover');

  const ended=sql(`select (ended_at-interval '10 minutes')::text from public.shifts where id='${duty}';`);
  const checkout={p_id:randomUUID(),p_shift_id:duty,p_incoming_shift_id:null,p_notes:guardCheckout,
    p_equipment:'',p_incident_ids:[],p_ended_at:ended};
  const first=await rpc(verifiedGuard,'submit_guard_end_duty',checkout);
  assert.equal(first.status,200,'Local authenticated guard evidence rejected.');
  assert.deepEqual(first,await rpc(verifiedGuard,'submit_guard_end_duty',checkout));
  await details.getByRole('button',{name:'Close details'}).click();
  await adminPage.getByRole('button',{name:'Refresh',exact:true}).click();
  await details.getByText(/Guard checkout evidence received/).waitFor();
  await details.getByRole('button',{name:'Close details'}).click();
  print('Actual guard API late submission is visible in the authenticated browser audit history and replays identically');

  await adminPage.getByRole('button',{name:'Create shift',exact:true}).click();
  const creation=adminPage.getByRole('dialog',{name:'Create shift assignment'});
  await creation.getByLabel('Security post').selectOption(post);
  await creation.getByLabel('Planned start').fill(datetime(2*3600000));
  await creation.getByLabel('Planned end').fill(datetime(4*3600000));
  await creation.getByLabel('Eligible guard').selectOption(guard.id);
  const createCalls=await loseFirstResponse(adminPage,'save_scheduled_shift',result=>{
    assert.match(result.id??'',/^[0-9a-f-]{36}$/);
    assert.equal(sql(`select count(*) from public.shifts where id='${result.id}' and site_id='${site}';`),'1');
  });
  await creation.getByRole('button',{name:'Save',exact:true}).click();
  await creation.getByRole('alert').waitFor();
  assert.equal(await adminPage.getByText('Shift assignment confirmed.').count(),0);
  await creation.getByRole('button',{name:'Save',exact:true}).click();
  await adminPage.getByText('Shift assignment confirmed.').waitFor();
  sameRetry(createCalls);
  const created=createCalls[0].result.id;
  assert.equal(sql(`select (select count(*) from public.shifts where site_id='${site}' and security_post_id='${post}'),
    (select count(*) from public.audit_events where action='shift.scheduled' and entity_ref='${created}'),
    (select count(*) from private.scheduling_receipts where operation_id='${createCalls[0].body.p_operation_id}');`),'1|1|1');
  await adminPage.unroute(local+'/rest/v1/rpc/save_scheduled_shift');
  print('Real browser shift creation lost a committed response; exact retry left one shift, audit and receipt');

  await supervised.getByRole('button',{name:'Close details'}).click();
  await supervisorPage.getByRole('button',{name:'Refresh',exact:true}).click();
  await supervisorPage.getByRole('button',{name:'Overview',exact:true}).click();
  await adminPage.getByRole('button',{name:'Overview',exact:true}).click();
  const fromAdmin=await openRosterRow(adminPage,'Upcoming');
  const fromSupervisor=await openRosterRow(supervisorPage,'Upcoming');
  await fromAdmin.getByRole('button',{name:'Edit assignment'}).click();
  await fromSupervisor.getByRole('button',{name:'Edit assignment'}).click();
  const older=supervisorPage.getByRole('dialog',{name:'Edit shift assignment'});
  const newer=adminPage.getByRole('dialog',{name:'Edit shift assignment'});
  await older.getByLabel('Shift type').selectOption('night');
  await newer.getByLabel('Shift type').selectOption('day');
  await newer.getByRole('button',{name:'Save',exact:true}).click();
  await adminPage.getByText('Shift update confirmed.').waitFor();
  await older.getByRole('button',{name:'Save',exact:true}).click();
  await older.getByText('Your draft is still in the form.').waitFor();
  assert.equal(await older.getByLabel('Shift type').inputValue(),'night');
  assert.equal(sql(`select shift_kind||'|'||scheduling_revision from public.shifts where id='${created}';`),'day|2');
  print('Two real browser sessions enforce the stale revision and keep the losing editor’s draft');

  const mobile=await pageFor(admin,{width:390,height:844});
  await rosterTable(mobile).getByText('Upcoming',{exact:true}).waitFor();
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  const mobileSection=mobile.getByRole('region',{name:name+' scheduling'});
  assert.ok(await mobileSection.evaluate(panel=>panel.scrollWidth<=panel.clientWidth));
  const shortcut=await rosterTable(mobile).getByRole('button',{name:'Open roster record'}).boundingBox();
  assert.ok(shortcut&&shortcut.x+shortcut.width<=390);
  await screenshot(mobile,'overview-390');
  print('Authenticated Overview renders without document overflow at 390px');
} finally {
  await browser.close();
}
