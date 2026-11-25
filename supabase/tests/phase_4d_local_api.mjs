// Fictional test records against the existing local stack. Remove only the
// exact records created by this run unless --keep-for-browser is requested.
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parseEnv} from 'node:util';

const env = parseEnv(readFileSync(new URL('../../apps/supervisor/.env.local', import.meta.url), 'utf8'));
const base = 'http://127.0.0.1:54321';
assert.equal(env.VITE_SUPABASE_URL?.replace(/\/$/, ''), base, 'Only the Baseguard loopback stack is supported');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
assert.ok(key && !key.startsWith('sb_secret_'), 'A local publishable key is required');
if (key.split('.').length === 3) {
  const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
  assert.equal(claims.role, 'anon', 'A legacy local anonymous key is required');
}

const run = 'QA4D-' + randomBytes(4).toString('hex').toUpperCase();
const siteIds = [];
const userIds = [];
const keepForBrowser = process.argv.includes('--keep-for-browser');
let complete = false;

function sql(statement) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_Baseguard', 'psql',
    '-XqAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
  {input: statement, encoding: 'utf8'});
  assert.equal(result.status, 0, 'Local fixture provisioning/check failed');
  return result.stdout.trim();
}

async function request(path, {body, token, range} = {}) {
  const headers = {apikey: key, 'Content-Type': 'application/json'};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (range) headers.Range = range;
  const response = await fetch(base + path, {
    headers, method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    redirect: 'error',
  });
  return {status: response.status, data: await response.json()};
}

async function account(role) {
  const email = run.toLowerCase() + '-' + role + '@baseguard.test';
  const password = randomBytes(24).toString('base64url') + '4!aA';
  const created = await request('/auth/v1/signup', {body: {email, password}});
  assert.ok(created.status < 300, 'Local fictional signup failed');
  const id = created.data.user?.id ?? created.data.id;
  assert.match(id ?? '', /^[0-9a-f-]{36}$/);
  userIds.push(id);
  sql(`update auth.users set email_confirmed_at=coalesce(email_confirmed_at,now()) where id='${id}' and email='${email}';
    insert into public.profiles (id,display_name,role,is_active) values ('${id}','Sprint 4 QA ${role}','${role}',true);`);
  const signedIn = await request('/auth/v1/token?grant_type=password', {body: {email,password}});
  assert.ok(signedIn.status === 200 && signedIn.data.user?.id === id && signedIn.data.access_token, 'Local password grant failed');
  return {id, token: signedIn.data.access_token};
}

function rpc(account, name, body, range) {
  return request('/rest/v1/rpc/' + name, {body, token: account?.token, range});
}

function success(result, label) {
  assert.ok(result.status >= 200 && result.status < 300, label + ' returned HTTP ' + result.status + ': ' + (result.data?.code ?? ''));
  return result.data;
}
function denied(result, code, label) {
  assert.ok(result.status >= 400 && result.data?.code === code, label + ' returned HTTP ' + result.status + ': ' + result.data?.code);
}
function check(label) { console.log('PASS: ' + label); }

const boundary = {type:'Polygon',coordinates:[[[31.031,-17.81],[31.039,-17.81],[31.039,-17.803],[31.031,-17.803],[31.031,-17.81]]]};
const center = {type:'Point',coordinates:[31.035,-17.806]};
const outside = {type:'Point',coordinates:[31.041,-17.807]};

try {
  const admin = await account('admin');
  const supervisor = await account('supervisor');
  const guard = await account('guard');
  async function create(suffix, name) {
    const record = success(await rpc(admin, 'create_managed_site', {p_code:run + '-' + suffix,p_name:name}), 'Create site');
    assert.match(record.id, /^[0-9a-f-]{36}$/);
    siteIds.push(record.id);
    return record;
  }
  const site = await create('MAP','Sprint 4 Test Site');
  const perimeter = await create('BOUND','Sprint 4 Boundary-only Site');
  const archive = await create('OFF','Sprint 4 Inactive Site');
  const scoped = success(await request('/rest/v1/sites?select=id', {token:admin.token}), 'Operational sites');
  assert.ok(scoped.some(row => row.id === site.id));
  assert.equal(sql(`select count(*) from public.site_assignments where user_id='${admin.id}' and site_id='${site.id}' and role_at_site='admin';`), '1');
  check('administrator creates sites and receives an administrator assignment');

  denied(await rpc(supervisor,'create_managed_site',{p_code:run+'-DENY',p_name:'Denied'}),'42501','Supervisor create');
  denied(await rpc(guard,'create_managed_site',{p_code:run+'-DENY',p_name:'Denied'}),'42501','Guard create');
  sql(`insert into public.site_assignments(user_id,site_id,role_at_site) values
    ('${supervisor.id}','${site.id}','supervisor'), ('${supervisor.id}','${archive.id}','supervisor'),
    ('${guard.id}','${site.id}','guard');`);
  const supervisorScope = success(await rpc(supervisor,'list_managed_sites',{p_site_id:null},'0-249'), 'Supervisor directory');
  assert.deepEqual(new Set(supervisorScope.map(row=>row.id)), new Set([site.id,archive.id]));
  assert.deepEqual(success(await rpc(supervisor,'list_site_security_posts',{p_site_id:perimeter.id},'0-249'),'Cross-site post read'),[]);
  denied(await rpc(supervisor,'save_site_geography',{p_site_id:perimeter.id,p_expected_revision:0,p_details:null,p_center:null,p_boundary:boundary}),'42501','Cross-site geography mutation');
  denied(await rpc(null,'list_managed_sites',{p_site_id:null}),'42501','Anonymous read');
  assert.ok((await request('/rest/v1/site_geography?select=site_id',{token:supervisor.token})).status >= 400);
  check('real gateway enforces supervisor assignment, guard restrictions, anonymous access, and RPC-only geography');

  const edited = success(await rpc(supervisor,'update_managed_site',{p_site_id:site.id,p_expected_revision:1,p_name:'Sprint 4 Test Site',p_is_active:true}),'Supervisor site edit');
  assert.equal(edited.revision,2);
  const geography = {p_site_id:site.id,p_expected_revision:0,p_details:'Fictional local test geography',p_center:center,p_boundary:boundary};
  success(await rpc(supervisor,'save_site_geography',geography),'Save site geography');
  denied(await rpc(supervisor,'save_site_geography',geography),'PT409','Outdated revision');
  denied(await rpc(supervisor,'save_site_geography',{...geography,p_expected_revision:1,p_center:{type:'Point',coordinates:[500,0]}}),'22023','Invalid geometry');
  success(await rpc(admin,'save_site_geography',{...geography,p_site_id:perimeter.id,p_center:null}),'Save boundary-only site');
  const [reloaded] = success(await rpc(supervisor,'list_managed_sites',{p_site_id:site.id},'0-249'),'Reload coordinates');
  assert.deepEqual(reloaded.center,center);
  assert.deepEqual(reloaded.boundary,boundary);
  const [boundaryOnly] = success(await rpc(admin,'list_managed_sites',{p_site_id:perimeter.id}),'Reload boundary-only site');
  assert.equal(boundaryOnly.center,null);
  assert.deepEqual(boundaryOnly.boundary,boundary);
  check('supervisor edits, saved center and perimeter reload, boundary-only site persists, invalid and stale saves fail');

  const postFields = {p_site_id:site.id,p_code:'QA-GATE',p_name:'Test Gate',p_location:outside};
  const post = success(await rpc(supervisor,'create_security_post',postFields),'Create outside post');
  assert.equal(post.outside_boundary,true);
  const amended = success(await rpc(supervisor,'update_security_post',{...postFields,p_post_id:post.id,p_expected_revision:1,p_name:'Test Gate East',p_is_active:false}),'Edit and deactivate post');
  assert.equal(amended.is_active,false);
  assert.equal(amended.name,'Test Gate East');
  success(await rpc(supervisor,'create_security_post',{...postFields,p_code:'QA-REVIEW',p_name:'Sprint 4 Review Gate'}),'Create active review post');
  check('post creation, editing, deactivation, and outside-perimeter warning');

  const shiftId = randomUUID();
  sql(`insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status)
    values ('${shiftId}','${site.id}','${guard.id}',now()+interval '1 hour',now()+interval '2 hours','scheduled');`);
  denied(await rpc(admin,'update_managed_site',{p_site_id:site.id,p_expected_revision:2,p_name:edited.name,p_is_active:false}),
    '23514','Unsafe deactivation');
  success(await rpc(admin,'update_managed_site',{p_site_id:archive.id,p_expected_revision:1,p_name:archive.name,p_is_active:false}),'Deactivate site');
  assert.equal(success(await rpc(supervisor,'list_managed_sites',{p_site_id:archive.id}),'Inactive management read')[0].is_active,false);
  assert.deepEqual(success(await request('/rest/v1/sites?select=id&id=eq.'+archive.id,{token:admin.token}),'Inactive operational read'),[]);
  check('scheduled shift blocks unsafe deactivation; inactive site remains management-only');

  if (keepForBrowser) {
    sql(`insert into public.site_assignments(user_id,site_id,role_at_site)
      select p.id,s.id,'supervisor' from public.profiles p join auth.users u on u.id=p.id
      cross join public.sites s where u.email='supervisor@baseguard.test' and p.role='supervisor'
        and s.id in ('${site.id}','${perimeter.id}','${archive.id}');`);
    console.log('Fictional browser review sites retained under code prefix ' + run);
  }
  complete = true;
} finally {
  if (!complete || !keepForBrowser) {
    const ids = siteIds.length ? siteIds.map(id => `'${id}'`).join(',') : "'00000000-0000-0000-0000-000000000000'";
    const actors = userIds.length ? userIds.map(id => `'${id}'`).join(',') : "'00000000-0000-0000-0000-000000000000'";
    sql(`begin;
      delete from public.audit_events where site_id in (${ids});
      delete from public.security_posts where site_id in (${ids});
      delete from public.site_geography where site_id in (${ids});
      delete from public.shifts where site_id in (${ids});
      delete from public.site_assignments where site_id in (${ids});
      delete from public.sites where id in (${ids});
      delete from auth.users where id in (${actors});
      commit;`);
  }
}
