// Run against disposable PostgreSQL using PGlite. No network or Supabase credentials required.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {enqueueHandover,handoverTable,replayHandovers} from '../apps/guard/src/handover-outbox.ts';
import {syncPending} from '../apps/guard/src/sync-engine.ts';
import {syncPhotos} from '../apps/guard/src/photo-sync.ts';
import {missedCheckIn} from '../apps/guard/src/shift-coverage.ts';
const {PGlite}=await import(process.env.BASEGUARD_TEST_PGLITE || '@electric-sql/pglite');
const pg=new PGlite();
const temp=mkdtempSync(join(tmpdir(),'baseguard-outbox-'));
const path=join(temp,'operations.sqlite');
let local=new DatabaseSync(path);
const store={runAsync:async(sql,...args)=>local.prepare(sql).run(...args),getAllAsync:async(sql,...args)=>local.prepare(sql).all(...args)};
local.exec(handoverTable);
try{
 await pg.exec("create role anon; create role authenticated; create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated");
 await pg.exec("create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(bucket_id text,name text,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update on storage.objects to authenticated");
 for(const file of ['schema.sql','migrations/20261021095939_guard_duty_presence.sql','migrations/202611190001_guard_workflows.sql','migrations/202611190002_incident_response.sql','migrations/202611190003_incident_photo.sql','migrations/202611190004_end_duty.sql'])
  await pg.exec(readFileSync(new URL('../supabase/'+file,import.meta.url),'utf8'));
 const [a,b,supervisor,site,s1,s2,ob,incident,h]=Array.from({length:9},()=>randomUUID());
 await pg.query("insert into sites(id,name,code) values($1,'Test site','QA')",[site]);
 for(const [id,role] of [[a,'guard'],[b,'guard'],[supervisor,'supervisor']]){
  await pg.query('insert into auth.users values($1)',[id]);
  await pg.query("insert into profiles values($1,'Test user',$2,true)",[id,role]);
  await pg.query('insert into site_assignments(user_id,site_id,role_at_site) values($1,$2,$3)',[id,site,role]);
 }
 for(const [shift,user] of [[s1,a],[s2,b]])await pg.query("insert into shifts(id,site_id,guard_id,started_at,status,post) values($1,$2,$3,now()-interval '1 hour','scheduled','Gate')",[shift,site,user]);
 await pg.query('update shifts set successor_shift_id=$1 where id=$2',[s2,s1]);
 await pg.exec('set role authenticated');
 const login=id=>pg.query("select set_config('test.uid',$1,false)",[id]);
 await login(a);
 assert.equal((await pg.query('select guard_handover_recipient($1) as name',[s1])).rows[0].name,'Test user');
 await pg.query('select start_guard_duty($1)',[s1]);
 const time=new Date().toISOString();
 local.exec('CREATE TABLE reports(id TEXT PRIMARY KEY,actor TEXT,kind TEXT,payload TEXT,state TEXT)');
 for(const [id,kind,extra] of [[ob,'occurrence',{p_category:'routine',p_narrative:'Vehicle at gate',p_event_at:time}],
  [incident,'incident',{p_category:'other',p_severity:'medium',p_description:'Vehicle at gate',p_reported_at:time,p_source_occurrence_id:ob}]]){
  local.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run(id,a,kind,JSON.stringify({p_id:id,p_site_id:site,p_shift_id:s1,...extra}),'queued');
 }
 local.close();local=new DatabaseSync(path);
 const mark=(id,state)=>{local.prepare('UPDATE reports SET state=? WHERE id=?').run(state,id);};
 const result=await syncPending(a,{
  pending:async actor=>local.prepare("SELECT * FROM reports WHERE actor=? AND state<>'received' ORDER BY rowid").all(actor),
  markSending:async id=>mark(id,'sending'),markFailed:async id=>mark(id,'failed'),markReceived:async id=>mark(id,'received'),
  submit:async(kind,p)=>{
   const sql=kind==='occurrence'?'select submit_ob_entry($1,$2,$3,$4,$5,$6) as receipt':'select submit_linked_incident($1,$2,$3,$4,$5,$6,$7,$8) as receipt';
   return (await pg.query(sql,Object.values(p))).rows[0].receipt;
  }
 });
 assert.deepEqual(result,{sent:2,failed:0});
 for(let i=0;i<2;i++)await pg.query("select submit_linked_incident($1,$2,$3,'other','medium','Vehicle at gate',$4,$5)",[incident,site,s1,time,ob]);
 assert.equal((await pg.query('select source_occurrence_id from incidents')).rows[0].source_occurrence_id,ob);
 const photo=randomUUID();
 const photoPath=incident+'/'+photo+'.jpg';
 assert.equal((await pg.query('select register_incident_photo($1,$2) as path',[photo,incident])).rows[0].path,photoPath);
 assert.equal((await pg.query('select register_incident_photo($1,$2) as path',[photo,incident])).rows[0].path,photoPath);
 await pg.query("insert into storage.objects(bucket_id,name) values('incident-evidence',$1)",[photoPath]);
 await pg.query("insert into storage.objects(bucket_id,name) values('incident-evidence',$1) on conflict(bucket_id,name) do update set name=excluded.name",[photoPath]);
 assert.equal((await pg.query("select count(*)::int as n from storage.objects where bucket_id='incident-evidence'")).rows[0].n,1);
 local.exec('CREATE TABLE photos(id TEXT PRIMARY KEY,incident_id TEXT,uri TEXT,state TEXT,error TEXT)');
 local.prepare("INSERT INTO photos VALUES(?,?,?,'queued',NULL)").run(photo,incident,'private/photo.jpg');
 local.close();local=new DatabaseSync(path);
 let uploads=0;
 const photoAdapter={
  pending:async()=>local.prepare("SELECT id,incident_id,uri FROM photos WHERE state<>'uploaded'").all(),
  uploading:async id=>local.prepare("UPDATE photos SET state='uploading' WHERE id=?").run(id),
  uploaded:async id=>local.prepare("UPDATE photos SET state='uploaded' WHERE id=?").run(id),
  failed:async(id,error)=>local.prepare("UPDATE photos SET state='failed',error=? WHERE id=?").run(error,id),
  notify:async()=>{},
  send:async item=>{assert.equal(item.id,photo);uploads++;if(uploads===1)throw Error('connection interrupted after upload');}
 };
 assert.deepEqual(await syncPhotos(photoAdapter),{sent:0,failed:1});
 local.close();local=new DatabaseSync(path);
 assert.deepEqual(await syncPhotos(photoAdapter),{sent:1,failed:0});
 assert.deepEqual(await syncPhotos(photoAdapter),{sent:0,failed:0});
 assert.equal(uploads,2);
 await login(b);
 assert.equal((await pg.query("select * from storage.objects where bucket_id='incident-evidence'")).rows.length,0);
 await assert.rejects(pg.query('select register_incident_photo($1,$2)',[randomUUID(),incident]),/Not authorized/);
 await login(supervisor);
 assert.equal((await pg.query("select * from storage.objects where bucket_id='incident-evidence'")).rows.length,1);
 await login(a);
 const draft={p_id:h,p_shift_id:s1,p_incoming_shift_id:s2,p_notes:'Check gate',p_equipment:'Two keys',p_incident_ids:[incident]};
 await pg.exec('reset role');
 await pg.query("update shifts set post='Other gate' where id=$1",[s2]);
 await pg.exec('set role authenticated');await login(a);
 await assert.rejects(pg.query("select submit_guard_handover($1,$2,$3,'Check gate','Two keys',$4)",[h,s1,s2,[incident]]),/Invalid handover/);
 await pg.exec('reset role');await pg.query("update shifts set post='Gate' where id=$1",[s2]);
 await pg.exec('set role authenticated');await login(a);
 await enqueueHandover(store,a,'submit',s1,draft);
 await enqueueHandover(store,a,'submit',s1,{...draft,p_id:randomUUID()});
 local.close();local=new DatabaseSync(path);
 const send=async op=>{
  const p=JSON.parse(op.payload);
  const response=op.kind==='submit'?p.p_ended_at?await pg.query('select submit_guard_end_duty($1,$2,$3,$4,$5,$6,$7) as r',
   [p.p_id,p.p_shift_id,p.p_incoming_shift_id,p.p_notes,p.p_equipment,p.p_incident_ids,p.p_ended_at]):
   await pg.query('select submit_guard_handover($1,$2,$3,$4,$5,$6) as r',
   [p.p_id,p.p_shift_id,p.p_incoming_shift_id,p.p_notes,p.p_equipment,p.p_incident_ids]):
   await pg.query('select receive_guard_handover($1) as r',[p.p_id]);
  return response.rows[0].r;
 };
 assert.deepEqual(await replayHandovers(store,a,async op=>{await send(op);throw Error('Lost receipt');}),{sent:0,failed:1});
 assert.deepEqual(await replayHandovers(store,a,send),{sent:1,failed:0});
 await assert.rejects(pg.query('select receive_guard_handover($1)',[h]),/Unauthorized recipient/);
 await login(supervisor);
 await pg.query("select acknowledge_incident($1,'Reviewed')",[incident]);
 const updateId=randomUUID();
 await pg.query("select record_incident_response($1,$2,'progress','Investigating')",[updateId,incident]);
 await pg.query("select record_incident_response($1,$2,'progress','Investigating')",[updateId,incident]);
 assert.equal((await pg.query('select count(*)::int as n from incident_updates where id=$1',[updateId])).rows[0].n,1);
 await assert.rejects(pg.query("select record_incident_response($1,$2,'progress','Different note')",[updateId,incident]),/Conflicting response retry/);
 const resolutionId=randomUUID();
 await pg.query("select record_incident_response($1,$2,'resolved','Issue resolved')",[resolutionId,incident]);
 assert.equal((await pg.query('select status from incidents where id=$1',[incident])).rows[0].status,'resolved');
 assert.equal((await pg.query('select author_id from incident_updates where id=$1',[resolutionId])).rows[0].author_id,supervisor);
 assert.equal((await pg.query('select * from shift_handovers where accepted_at is null')).rows.length,1);
 await assert.rejects(pg.query('select receive_guard_handover($1)',[h]),/Unauthorized recipient/);
 await enqueueHandover(store,b,'receive',h,{p_id:h});
 local.close();local=new DatabaseSync(path);
 assert.equal((await pg.query('select * from shift_handovers where accepted_at is null')).rows.length,1);
 await login(b);assert.deepEqual(await replayHandovers(store,b,send),{sent:1,failed:0});
 await pg.query('select receive_guard_handover($1)',[h]);
 await login(supervisor);
 assert.equal((await pg.query('select accepted_by from shift_handovers where accepted_at is not null')).rows[0].accepted_by,b);
 // An offline end-duty command without a successor survives a database reopen,
 // then retries the same server operation after a lost receipt.
 const shiftWithoutReplacement=randomUUID(),gapId=randomUUID();
 await pg.exec('reset role');
 await pg.query("insert into shifts(id,site_id,guard_id,started_at,status,post) values($1,$2,$3,now()-interval '10 minutes','active','North')",[shiftWithoutReplacement,site,a]);
 await pg.exec('set role authenticated');await login(a);
 const gapDraft={p_id:gapId,p_shift_id:shiftWithoutReplacement,p_incoming_shift_id:null,
  p_notes:'No replacement at post',p_equipment:'Radio and keys',p_incident_ids:[],p_ended_at:new Date().toISOString()};
 await enqueueHandover(store,a,'submit',shiftWithoutReplacement,gapDraft);
 local.close();local=new DatabaseSync(path);
 assert.deepEqual(await replayHandovers(store,a,async op=>{await send(op);throw Error('Lost receipt');}),{sent:0,failed:1});
 assert.deepEqual(await replayHandovers(store,a,send),{sent:1,failed:0});
 await assert.rejects(pg.query("select submit_guard_end_duty($1,$2,null,'No replacement at post','Radio and keys',$3,$4)",
  [gapId,shiftWithoutReplacement,[],new Date(Date.parse(gapDraft.p_ended_at)-1000).toISOString()]),/Conflicting end-duty retry/);
 await assert.rejects(pg.query('select receive_guard_handover($1)',[gapId]),/Unauthorized recipient/);
 await login(supervisor);
 const gap=(await pg.query('select incoming_guard_id,accepted_at,post from shift_handovers where id=$1',[gapId])).rows[0];
 assert.deepEqual(gap,{incoming_guard_id:null,accepted_at:null,post:'North'});
 assert.equal((await pg.query('select status from shifts where id=$1',[shiftWithoutReplacement])).rows[0].status,'completed');
 assert.equal(new Date((await pg.query('select ended_at from shifts where id=$1',[shiftWithoutReplacement])).rows[0].ended_at).toISOString(),gapDraft.p_ended_at);
 const now=Date.now(),started_at=new Date(now-60000).toISOString();
 assert.equal(missedCheckIn({status:'scheduled',started_at,ended_at:null},now),true);
 assert.equal(missedCheckIn({status:'scheduled',started_at:new Date(now+60000).toISOString(),ended_at:null},now),false);
 assert.equal(missedCheckIn({status:'completed',started_at,ended_at:null},now),false);
 console.log('PASS: two guards and supervisor; linked occurrence retry; outgoing submission retry; wrong guard denied; supervisor pending until recipient receipt.');
}finally{local.close();rmSync(temp,{recursive:true});await pg.close();}
