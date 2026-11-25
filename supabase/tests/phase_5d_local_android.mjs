// Run with the Baseguard QA emulator and the SQLCipher development client.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseEnv} from 'node:util';
import {setTimeout as wait} from 'node:timers/promises';

const env=parseEnv(readFileSync(new URL('../../apps/supervisor/.env.local',import.meta.url),'utf8'));
const local='http://127.0.0.1:54321';
assert.equal(env.VITE_SUPABASE_URL?.replace(/\/$/,''),local);
const key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.ok(key&&!key.startsWith('sb_secret_'));
if (key.split('.').length===3) assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role,'anon');
const serial=process.env.BASEGUARD_QA_EMULATOR??'emulator-5554';
assert.match(serial,/^emulator-\d+$/,'Run only against a QA emulator.');
const app='zw.baseguard.smartops.guard.dev';
const uri='baseguard-smartops://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8098';
const xml='/sdcard/baseguard-5d-ui.xml';
const resumeCode=process.env.BASEGUARD_QA_RESUME;
if (resumeCode) assert.match(resumeCode,/^QA5D-MOBILE-[0-9A-F]{8}$/);
const code=resumeCode??'QA5D-MOBILE-'+randomBytes(4).toString('hex').toUpperCase();
const email=code.toLowerCase()+'@baseguard.test';
const password=randomBytes(24).toString('hex')+'1aA';

function adb(...args) {
  const run=spawnSync('adb',['-s',serial,...args],{encoding:'utf8',timeout:18000});
  if (run.status!==0) throw new Error('QA emulator command failed.');
  return run.stdout.trim();
}
function sql(input) {
  const run=spawnSync('docker',['exec','-i','supabase_db_Baseguard','psql',
    '-XqAt','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8'});
  assert.equal(run.status,0,'Local fixture or committed-state verification failed.');
  return run.stdout.trim();
}
function ui() {
  const dump=adb('shell','uiautomator','dump',xml);
  if (!dump.includes('dumped to')) return [];
  return [...adb('shell','cat',xml).matchAll(/<node\s+([^>]+)>/g)].map(([,raw])=>
    Object.fromEntries([...raw.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,value])=>[key,value])));
}
function find(nodes,title,type) {
  const expected=title.toLowerCase();
  const exact=node=>[node.text,node['content-desc']].some(value=>value?.toLowerCase()===expected);
  return nodes.find(node=>exact(node)&&node.enabled==='true'&&(!type||node.class===type));
}
async function visible(title,{type,scroll=false}={}) {
  for (let attempt=0;attempt<13;attempt++) {
    const node=find(ui(),title,type);
    if (node) return node;
    if (scroll&&attempt<5) {
      adb('shell','input','swipe',String(midX),String(bottomY),String(midX),String(topY),'420');
    }
    await wait(600);
  }
  if (!['Work email','Password','Sign in'].includes(title)) {
    screenshot('failure-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-'));
  }
  throw new Error('QA screen did not show: '+title);
}
function tap(node) {
  const [x1,y1,x2,y2]=node.bounds.match(/\d+/g).map(Number);
  adb('shell','input','tap',String(Math.round((x1+x2)/2)),String(Math.round((y1+y2)/2)));
}
const press=async(title,options)=>tap(await visible(title,options));
function launch() { adb('shell','am','start','-W','-a','android.intent.action.VIEW','-d',uri,'-p',app); }
function restart() { adb('shell','am','force-stop',app); launch(); }
function screenshot(name) {
  const folder=process.env.BASEGUARD_SCREENSHOTS;
  if (!folder) return;
  const image=spawnSync('adb',['-s',serial,'exec-out','screencap','-p']);
  if (image.status===0) writeFileSync(join(folder,code+'-'+name+'.png'),image.stdout);
}
const [,width,height]=/Physical size: (\d+)x(\d+)/.exec(adb('shell','wm','size'));
const midX=Math.round(Number(width)/2), bottomY=Math.round(Number(height)*0.83),topY=Math.round(Number(height)*0.28);

let guard, shift, next;
if (resumeCode) {
  [guard,shift,next]=sql(`select a.guard_id,a.id,b.id from public.sites s
    join public.shifts a on a.site_id=s.id and a.post='Fictional previous post' and a.status='active'
    join public.shifts b on b.site_id=s.id and b.post='Fictional next post' and b.status='scheduled'
    where s.code='${code}';`).split('|');
  assert.ok(guard&&shift&&next,'The unfinished emulator fixture is unavailable.');
  restart();
} else {
  const site=randomUUID();
  shift=randomUUID();next=randomUUID();
  await visible('Work email',{type:'android.widget.EditText'});
  const created=await fetch(local+'/auth/v1/signup',{method:'POST',redirect:'error',
    headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  assert.ok(created.ok,'Fictional guard signup failed.');
  const identity=await created.json();
  guard=identity.user?.id??identity.id;
  assert.match(guard??'',/^[0-9a-f-]{36}$/);
  sql(`update auth.users set email_confirmed_at=coalesce(email_confirmed_at,now()) where id='${guard}' and email='${email}';
    insert into public.profiles(id,display_name,role,is_active) values ('${guard}','QA Recovery Guard','guard',true);
    insert into public.sites(id,code,name) values ('${site}','${code}','QA Recovery Site');
    insert into public.site_assignments(user_id,site_id,role_at_site,valid_from) values ('${guard}','${site}','guard',now()-interval '1 day');
    insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status,post,checked_in_at) values
      ('${shift}','${site}','${guard}',now()-interval '3 hours',now()-interval '60 minutes','active','Fictional previous post',now()-interval '3 hours'),
      ('${next}','${site}','${guard}',now()-interval '30 minutes',now()+interval '1 hour','scheduled','Fictional next post',null);`);
  await press('Work email',{type:'android.widget.EditText'});
  adb('shell','input','text',email);
  await press('Password',{type:'android.widget.EditText'});
  adb('shell','input','text',password);
  adb('shell','input','keyevent','4');
  await press('Sign in',{type:'android.widget.Button'});
}
console.log('Android fixture site: '+code);
await visible('Review End Duty');
assert.equal(Boolean(find(ui(),'Start duty')),false);
console.log('PASS: authenticated native Guard Home shows overdue recovery ahead of the next assignment');
const originalAirplane=adb('shell','settings','get','global','airplane_mode_on');
try {
  adb('shell','cmd','connectivity','airplane-mode','enable');
  adb('reverse','--remove','tcp:54321');
  restart();
  await visible('Cached overdue duty');
  screenshot('cached-overdue-home');
  await press('Review End Duty');
  await press('I am ending duty now',{scroll:true});
  await press('Review End Duty',{scroll:true});
  await press('Confirm End Duty',{scroll:true});
  await press('Save End Duty');
  await visible('Saved locally · Server receipt pending',{scroll:true});
  screenshot('queued-end-duty');
  assert.equal(sql(`select status from public.shifts where id='${shift}';`),'active');
  restart();
  await visible('End duty waiting for server');
  assert.equal(sql(`select count(*) from public.shift_handovers where outgoing_shift_id='${shift}';`),'0');
  console.log('PASS: SQLCipher cache survives the first offline cold start, and the queued End Duty survives a second cold start without a server receipt');
} finally {
  adb('reverse','tcp:54321','tcp:54321');
  adb('shell','cmd','connectivity','airplane-mode',originalAirplane==='1'?'enable':'disable');
}
await visible('Start duty');
await visible('No unsent local reports');
assert.equal(sql(`select status,(checked_out_at>ended_at)::text from public.shifts where id='${shift}';`),'completed|true');
assert.equal(sql(`select count(*) from public.shift_handovers where outgoing_shift_id='${shift}' and requested_end_at is not null and accepted_at is null;`),'1');
assert.equal(sql(`select count(*) from public.audit_events where actor_id='${guard}' and entity_ref='${shift}' and action='duty.checkout_confirmed';`),'1');
await press('Start duty');
await visible('View shift / End Duty');
assert.equal(sql(`select status,(checked_in_at is not null)::text from public.shifts where id='${next}';`),'active|true');
console.log('PASS: reconnect produces one real checkout and handover; the next duty can then be started');
