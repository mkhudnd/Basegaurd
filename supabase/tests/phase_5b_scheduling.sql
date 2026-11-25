-- Disposable Phase 5B contract assertions. Every fixture rolls back.
begin;
create temp table fixture(key text primary key,value uuid not null);
grant select,insert on fixture to authenticated;
create function pg_temp.ref(p_key text) returns uuid language sql stable as $$
  select value from fixture where key=p_key
$$;
create function pg_temp.ok(label text, passed boolean) returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end $$;
create function pg_temp.reject(label text, query text, state text, safe_message text default null)
returns void language plpgsql as $$
begin
  begin execute query;
  exception when others then
    if sqlstate=state and (safe_message is null or sqlerrm=safe_message) then
      raise notice 'PASS: %',label;
      return;
    end if;
    raise exception 'FAIL: % expected %, got % %',label,state,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % unexpectedly succeeded',label;
end $$;
create function pg_temp.at(h numeric) returns timestamptz language sql stable as $$
  select date_trunc('day',now()) + interval '2 days' + h * interval '1 hour'
$$;
create function pg_temp.book(op uuid,site text,guard_name text,post text,lo numeric,hi numeric,
  existing text default null,rev bigint default 0,successor text default null)
returns jsonb language sql as $$
  select public.save_scheduled_shift(op,pg_temp.ref(site),pg_temp.ref(existing),rev,
    pg_temp.ref(guard_name),pg_temp.ref(post),pg_temp.at(lo),pg_temp.at(hi),' Night ',pg_temp.ref(successor))
$$;
insert into fixture select name,gen_random_uuid() from unnest(array[
  'admin','supervisor','outsider','a','b','c','d','expired','one','two','post','other','spare',
  'op','legacy','outgoing','incoming','overdue','next','incident','ob','handover','legacy_out','legacy_in','legacy_handover'
]) name;
insert into auth.users(id) select value from fixture where key in ('admin','supervisor','outsider','a','b','c','d','expired');
insert into public.profiles(id,display_name,role,is_active)
select value,'QA ' || key,case when key='admin' then 'admin' when key in ('supervisor','outsider') then 'supervisor' else 'guard' end::public.smartops_role,true
from fixture where key in ('admin','supervisor','outsider','a','b','c','d','expired');
insert into public.sites(id,code,name) values
  (pg_temp.ref('one'),'5B-ONE','First test site'),(pg_temp.ref('two'),'5B-TWO','Second test site');
insert into public.security_posts(id,site_id,code,name) values
  (pg_temp.ref('post'),pg_temp.ref('one'),'GATE','Original gate'),
  (pg_temp.ref('spare'),pg_temp.ref('one'),'SPARE','Uncovered gate'),
  (pg_temp.ref('other'),pg_temp.ref('two'),'OTHER','Private second-site gate');
insert into public.site_assignments(user_id,site_id,role_at_site,valid_from,valid_to)
select u.value,s.value,p.role,now()-interval '10 days',case when u.key='expired' then now()-interval '1 day' else null end
from fixture u cross join fixture s join public.profiles p on true
where p.id=u.value and s.key in ('one','two')
  and (u.key in ('a','b','c','d','expired','admin') or (u.key='supervisor' and s.key='one') or (u.key='outsider' and s.key='two'));
update public.site_assignments set valid_to=pg_temp.at(31)
where user_id=pg_temp.ref('d') and site_id=pg_temp.ref('one');
insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status,post)
values(pg_temp.ref('legacy'),pg_temp.ref('two'),pg_temp.ref('a'),pg_temp.at(10),pg_temp.at(12),'scheduled','Legacy unmapped');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ref('admin')::text,true);
select pg_temp.ok('admin configures post capacity', (public.save_post_booking_capacity(
  gen_random_uuid(),pg_temp.ref('one'),pg_temp.ref('post'),0,2)->>'revision')='1');
select public.save_post_booking_capacity(gen_random_uuid(),pg_temp.ref('two'),pg_temp.ref('other'),0,1);
select public.save_post_staffing_requirement(gen_random_uuid(),pg_temp.ref('one'),pg_temp.ref('spare'),null,0,
  pg_temp.at(10),pg_temp.at(13),1,true);
select pg_temp.reject('staffing overlap rejected',$q$select public.save_post_staffing_requirement(gen_random_uuid(),
  pg_temp.ref('one'),pg_temp.ref('spare'),null,0,pg_temp.at(11),pg_temp.at(13),1,true)$q$,'PT409');
select set_config('request.jwt.claim.sub',pg_temp.ref('supervisor')::text,true);
select pg_temp.reject('supervisor cannot configure capacity',$q$select public.save_post_booking_capacity(
  gen_random_uuid(),pg_temp.ref('one'),pg_temp.ref('post'),1,3)$q$,'42501');
select pg_temp.reject('cross-site roster denied',$q$select public.list_roster(pg_temp.ref('two'),pg_temp.at(9),pg_temp.at(12))$q$,'42501');
select pg_temp.reject('direct scheduling write denied',$q$update public.shifts set status='cancelled'$q$,'42501');
select pg_temp.reject('direct capacity read denied',$q$select * from private.post_booking_capacity$q$,'42501');
select pg_temp.reject('expired guard membership rejected',$q$select pg_temp.book(
  gen_random_uuid(),'one','expired','post',10,11)$q$,'PT422');
select pg_temp.reject('part-interval membership rejected',$q$select pg_temp.book(
  gen_random_uuid(),'one','d','post',30,32)$q$,'PT422');
select pg_temp.reject('cross-site post rejected',$q$select pg_temp.book(
  gen_random_uuid(),'one','b','other',10,11)$q$,'PT422');
select pg_temp.reject('infinite planned end rejected',$q$select public.save_scheduled_shift(
  gen_random_uuid(),pg_temp.ref('one'),null,0,pg_temp.ref('b'),pg_temp.ref('post'),
  pg_temp.at(10),'infinity','custom')$q$,'22023');
select pg_temp.reject('cross-site legacy booking conflict is redacted',$q$select pg_temp.book(
  gen_random_uuid(),'one','a','post',11,12)$q$,'PT409','Guard is unavailable for this interval');
insert into fixture select 'first',(pg_temp.book(pg_temp.ref('op'),'one','b','post',10,11)->>'id')::uuid;
select pg_temp.ok('identical retry returns the original object', (pg_temp.book(pg_temp.ref('op'),'one','b','post',10,11)->>'id')::uuid=pg_temp.ref('first'));
select pg_temp.reject('changed retry rejected',$q$select pg_temp.book(pg_temp.ref('op'),'one','b','post',10,12)$q$,'PT409','Conflicting operation ID');
insert into fixture select 'second',(pg_temp.book(gen_random_uuid(),'one','c','post',11,12)->>'id')::uuid;
insert into fixture select 'spanning',(pg_temp.book(gen_random_uuid(),'one','d','post',10,12)->>'id')::uuid;
select pg_temp.ok('capacity two accepts a spanning booking across adjacent bookings',
  (select count(*)=3 from public.list_roster(pg_temp.ref('one'),pg_temp.at(10),pg_temp.at(12))));
select pg_temp.ok('coverage is independent of paginated roster',
  exists(select 1 from public.get_roster_coverage(pg_temp.ref('one'),pg_temp.at(10),pg_temp.at(12),pg_temp.ref('post')) r
    where (r->>'scheduled_personnel')::int=2 and r->>'confirmed_attendance' is null and not (r->>'requirements_configured')::boolean));
select pg_temp.ok('explicit staffing on an uncovered post yields a planned gap',
  exists(select 1 from public.get_roster_coverage(pg_temp.ref('one'),pg_temp.at(10),pg_temp.at(12),pg_temp.ref('spare')) r
    where r->>'planned_gap'='1' and r->>'booking_capacity' is null and r->>'required_staffing'='1'));
select pg_temp.reject('capacity two rejects a third simultaneous booking',$q$select pg_temp.book(
  gen_random_uuid(),'one','a','post',10,11)$q$,'PT409','Post booking capacity exceeded');
select pg_temp.reject('stale revision differs from booking conflict',$q$select pg_temp.book(
  gen_random_uuid(),'one','c','post',10,11,'first',0)$q$,'PT412');
select pg_temp.ok('supervisor reassigns and edits a future shift',
  (pg_temp.book(gen_random_uuid(),'one','a','post',12,13,'first',1)->>'revision')='2');
select pg_temp.ok('supervisor cancels unstarted shift',
  (public.cancel_scheduled_shift(gen_random_uuid(),pg_temp.ref('one'),pg_temp.ref('first'),2,' Changed roster ')->>'status')='cancelled');
insert into fixture select 'overnight',(pg_temp.book(gen_random_uuid(),'one','d','post',22,31)->>'id')::uuid;
select pg_temp.ok('overnight shift accepts assignment expiry at planned end',
  (public.get_roster_shift(pg_temp.ref('one'),pg_temp.ref('overnight'))->>'shift_kind')='night');
select pg_temp.ok('overnight shift appears on the following date',
  exists(select 1 from public.list_roster(pg_temp.ref('one'),pg_temp.at(24),pg_temp.at(26)) r
    where r->>'id'=pg_temp.ref('overnight')::text));
select pg_temp.ok('eligible guard list observes full interval',
  not exists(select 1 from public.list_eligible_guards(pg_temp.ref('one'),pg_temp.at(30),pg_temp.at(32)) r
    where r.id=pg_temp.ref('d')));
select set_config('request.jwt.claim.sub',pg_temp.ref('admin')::text,true);
select pg_temp.reject('cannot reduce capacity below existing commitments',$q$select public.save_post_booking_capacity(
  gen_random_uuid(),pg_temp.ref('one'),pg_temp.ref('post'),1,1)$q$,'PT423');
select pg_temp.reject('cannot deactivate booked post',$q$select public.update_security_post(pg_temp.ref('one'),
  pg_temp.ref('post'),1,'GATE','Original gate',false,null)$q$,'PT423');
select pg_temp.reject('Sprint 4 still blocks site deactivation',$q$select public.update_managed_site(
  pg_temp.ref('one'),1,'First test site',false)$q$,'23514');

reset role;
select pg_temp.reject('trusted account deactivation is blocked',$q$update public.profiles
  set is_active=false where id=pg_temp.ref('d')$q$,'PT423');
select pg_temp.reject('trusted assignment shortening is blocked',$q$update public.site_assignments set valid_to=pg_temp.at(30)
  where user_id=pg_temp.ref('d') and site_id=pg_temp.ref('one')$q$,'PT423');
select pg_temp.ok('idempotent booking writes one receipt and one creation event',
  (select count(*)=1 from private.scheduling_receipts where operation_id=pg_temp.ref('op')) and
  (select count(*)=1 from public.audit_events where entity_ref=pg_temp.ref('first') and action='shift.scheduled'));
create function pg_temp.fail_audit() returns trigger language plpgsql as $$
begin
  if new.action='shift.scheduled' then raise exception 'Injected audit failure' using errcode='23514'; end if;
  return new;
end $$;
create trigger scheduling_test_audit before insert on public.audit_events for each row execute function pg_temp.fail_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ref('supervisor')::text,true);
select pg_temp.reject('audit failure rejects whole booking',$q$select pg_temp.book(
  '525b0000-0000-4000-8000-000000000001','one','a','post',35,36)$q$,'23514');
reset role;
select pg_temp.ok('audit failure leaves no booking and no receipt',
  not exists(select 1 from public.shifts where scheduled_start_at=pg_temp.at(35)) and
  not exists(select 1 from private.scheduling_receipts where operation_id='525b0000-0000-4000-8000-000000000001'));
drop trigger scheduling_test_audit on public.audit_events;
set local role anon;
select pg_temp.reject('anonymous roster rejected',$q$select public.list_roster(null,now(),now()+interval '1 day')$q$,'42501');
reset role;
-- Revoke the supervisor's current membership after its successful operation.
update public.site_assignments set valid_to=now()
  where site_id=pg_temp.ref('one') and user_id=pg_temp.ref('supervisor');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ref('supervisor')::text,true);
select pg_temp.reject('site access is rechecked before retry receipt',$q$select pg_temp.book(
  pg_temp.ref('op'),'one','b','post',10,11)$q$,'42501');
reset role;

-- Set up a shift that ended on the calendar but was never checked out.
insert into public.shifts (id,site_id,guard_id,started_at,ended_at,status,post) values
 (pg_temp.ref('overdue'),pg_temp.ref('two'),pg_temp.ref('a'),now()-interval '5 hours',now()-interval '4 hours','active','Legacy gate'),
 (pg_temp.ref('next'),pg_temp.ref('two'),pg_temp.ref('a'),now()-interval '10 minutes',now()+interval '10 minutes','scheduled','Legacy gate');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ref('a')::text,true);
select pg_temp.reject('an overdue active shift still blocks activation',$q$select public.start_guard_duty(pg_temp.ref('next'))$q$,'P0001');
reset role;

-- A legacy pair must still compare the exact text and acknowledge the stored recipient.
insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status,post) values
 (pg_temp.ref('legacy_in'),pg_temp.ref('two'),pg_temp.ref('d'),now(),now()+interval '15 minutes','scheduled','Legacy relief');
select pg_temp.reject('legacy text mismatch is rejected on successor creation',$q$
  insert into public.shifts(site_id,guard_id,started_at,ended_at,status,post,successor_shift_id)
    values(pg_temp.ref('two'),pg_temp.ref('c'),now()-interval '15 minutes',now(),'scheduled','legacy relief',pg_temp.ref('legacy_in'))$q$,'PT422');
insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status,post,successor_shift_id) values
 (pg_temp.ref('legacy_out'),pg_temp.ref('two'),pg_temp.ref('c'),now()-interval '15 minutes',now(),'active','Legacy relief',pg_temp.ref('legacy_in'));
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ref('c')::text,true);
select pg_temp.ok('legacy exact-text handover submits with original receipt',
  (public.submit_guard_handover(pg_temp.ref('legacy_handover'),pg_temp.ref('legacy_out'),pg_temp.ref('legacy_in'),
    'Legacy handover',null,'{}')->>'id')=pg_temp.ref('legacy_handover')::text);
select set_config('request.jwt.claim.sub',pg_temp.ref('d')::text,true);
select pg_temp.ok('legacy recipient can acknowledge',
  (public.receive_guard_handover(pg_temp.ref('legacy_handover'))->>'id')=pg_temp.ref('legacy_handover')::text);
reset role;

insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status,post,
  security_post_id,qualifying_assignment_id,scheduled_start_at,scheduled_end_at,shift_kind)
select pg_temp.ref('incoming'),pg_temp.ref('one'),pg_temp.ref('c'),now()+interval '1 hour',now()+interval '2 hours',
  'scheduled','Renamed gate',pg_temp.ref('post'),a.id,now()+interval '1 hour',now()+interval '2 hours','day'
from public.site_assignments a where a.user_id=pg_temp.ref('c') and a.site_id=pg_temp.ref('one');
select pg_temp.reject('ambiguous legacy-to-structured successor rejected',$q$
  insert into public.shifts(site_id,guard_id,started_at,ended_at,status,post,successor_shift_id)
    values(pg_temp.ref('one'),pg_temp.ref('d'),now()-interval '5 minutes',now()+interval '1 hour',
      'scheduled','Renamed gate',pg_temp.ref('incoming'))$q$,'PT422');
insert into public.shifts(id,site_id,guard_id,started_at,ended_at,status,post,
  security_post_id,qualifying_assignment_id,scheduled_start_at,scheduled_end_at,shift_kind,successor_shift_id)
select pg_temp.ref('outgoing'),pg_temp.ref('one'),pg_temp.ref('b'),now()-interval '1 hour',now()+interval '1 hour',
  'scheduled','Original gate',pg_temp.ref('post'),a.id,now()-interval '1 hour',now()+interval '1 hour','day',pg_temp.ref('incoming')
from public.site_assignments a where a.user_id=pg_temp.ref('b') and a.site_id=pg_temp.ref('one');
select pg_temp.reject('backward successor cycle rejected',$q$update public.shifts set successor_shift_id=pg_temp.ref('outgoing')
  where id=pg_temp.ref('incoming')$q$,'PT422');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ref('b')::text,true);
select public.start_guard_duty(pg_temp.ref('outgoing'));
select pg_temp.ok('structured shift actually checked in',exists(select 1 from public.shifts
  where id=pg_temp.ref('outgoing') and status='active' and checked_in_at is not null));
select pg_temp.ok('break retains start status',(public.set_duty_presence(pg_temp.ref('outgoing'),'on_break')->>'presence_status')='on_break');
select public.set_duty_presence(pg_temp.ref('outgoing'),'on_duty');
select pg_temp.ok('structured recipient matches across historical text variants',
  public.guard_handover_recipient(pg_temp.ref('outgoing'))='QA c');
select pg_temp.ok('incident accepts original operational interval',
  (public.submit_incident(pg_temp.ref('incident'),pg_temp.ref('one'),pg_temp.ref('outgoing'),'other','low',
    'Offline scheduling incident sample',now()-interval '5 minutes')->>'id')=pg_temp.ref('incident')::text);
select pg_temp.ok('occurrence accepts original operational interval',
  (public.submit_ob_entry(pg_temp.ref('ob'),pg_temp.ref('one'),pg_temp.ref('outgoing'),'routine',
    'Offline scheduling occurrence sample',now()-interval '4 minutes')->>'id')=pg_temp.ref('ob')::text);
select set_config('request.jwt.claim.sub',pg_temp.ref('admin')::text,true);
select public.update_security_post(pg_temp.ref('one'),pg_temp.ref('post'),1,'GATE','Current gate label',true,null);
select pg_temp.ok('post renaming preserves historical shift text',
  (public.get_roster_shift(pg_temp.ref('one'),pg_temp.ref('outgoing'))->>'post')='Original gate'
  and (public.get_roster_shift(pg_temp.ref('one'),pg_temp.ref('incoming'))->>'post')='Renamed gate');
select pg_temp.reject('cannot cancel a protected incoming shift',$q$select public.cancel_scheduled_shift(
  gen_random_uuid(),pg_temp.ref('one'),pg_temp.ref('incoming'),1,'Attempted removal')$q$,'PT423');
reset role;
select pg_temp.reject('cannot clear active successor',$q$update public.shifts set successor_shift_id=null
  where id=pg_temp.ref('outgoing')$q$,'PT423');
select pg_temp.reject('cannot change intentional null successor',$q$update public.shifts set successor_shift_id=pg_temp.ref('legacy_in')
  where id=pg_temp.ref('overdue')$q$,'PT423');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ref('b')::text,true);
insert into fixture select 'first_end_receipt',(public.submit_guard_end_duty(pg_temp.ref('handover'),
  pg_temp.ref('outgoing'),pg_temp.ref('incoming'),'Offline structured handover','Radio',
  array[pg_temp.ref('incident')],now()+interval '1 second')->>'id')::uuid;
select pg_temp.ok('offline End Duty payload replays with the same receipt',
  public.submit_guard_end_duty(pg_temp.ref('handover'),pg_temp.ref('outgoing'),pg_temp.ref('incoming'),
    'Offline structured handover','Radio',array[pg_temp.ref('incident')],now()+interval '1 second')
  = (select jsonb_build_object('id',id,'received_at',submitted_at) from public.shift_handovers where id=pg_temp.ref('handover')));
select pg_temp.ok('End Duty preserves planned end and records actual checkout',
  exists(select 1 from public.shifts where id=pg_temp.ref('outgoing')
    and ended_at=now()+interval '1 second' and checked_out_at=ended_at and scheduled_end_at=now()+interval '1 hour'));
select pg_temp.ok('repeated occurrence payload keeps its server receipt',
  (public.submit_ob_entry(pg_temp.ref('ob'),pg_temp.ref('one'),pg_temp.ref('outgoing'),'routine',
    'Offline scheduling occurrence sample',now()-interval '4 minutes')->>'received_at') is not null);
select set_config('request.jwt.claim.sub',pg_temp.ref('d')::text,true);
select pg_temp.reject('wrong incoming guard denied',$q$select public.receive_guard_handover(pg_temp.ref('handover'))$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.ref('c')::text,true);
select pg_temp.ok('structured successor acknowledges with matching receipt',
  (public.receive_guard_handover(pg_temp.ref('handover'))->>'id')=pg_temp.ref('handover')::text);
reset role;
select pg_temp.ok('handover retains outgoing post label and structured reference',
  exists(select 1 from public.shift_handovers where id=pg_temp.ref('handover')
    and security_post_id=pg_temp.ref('post') and post='Original gate' and accepted_by=pg_temp.ref('c')));
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ref('admin')::text,true);
select public.save_post_staffing_requirement(gen_random_uuid(),pg_temp.ref('one'),pg_temp.ref('spare'),null,0,
  now()-interval '3 hours',now()-interval '2 hours',1,true);
select pg_temp.ok('past uncovered post reports both planned and attendance gaps',
  exists(select 1 from public.get_roster_coverage(pg_temp.ref('one'),now()-interval '3 hours',
    now()-interval '2 hours',pg_temp.ref('spare')) r
    where r->>'planned_gap'='1' and r->>'actual_attendance_gap'='1' and r->>'confirmed_attendance'='0'));
select pg_temp.ok('staffing RPC grants no anonymous access',
  not has_function_privilege('anon','public.save_post_booking_capacity(uuid,uuid,uuid,bigint,integer)','EXECUTE'));
rollback;
