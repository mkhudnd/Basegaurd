-- Recovery contract assertions. All fixtures in this suite roll back.
begin;
create temp table recovery_fixture(key text primary key,id uuid not null,receipt jsonb);
grant select,update on recovery_fixture to authenticated;
create function pg_temp.id(p_key text) returns uuid language sql stable as $$
  select id from recovery_fixture where key=p_key
$$;
create function pg_temp.ok(label text, passed boolean) returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %',label;
end $$;
create function pg_temp.reject(label text, statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=expected then raise notice 'PASS: %',label; return; end if;
    raise exception 'FAIL: % expected %, got % %',label,expected,sqlstate,sqlerrm;
  end;
  raise exception 'FAIL: % unexpectedly succeeded',label;
end $$;
create function pg_temp.reconcile(p_revision bigint default 1,p_reason text default 'Guard unavailable; supervisor contacted')
returns jsonb language sql as $$
  select public.reconcile_overdue_duty(pg_temp.id('admin_op'),pg_temp.id('site'),pg_temp.id('old'),p_revision,p_reason)
$$;
create function pg_temp.checkout(p_time timestamptz default now()-interval '2 hours')
returns jsonb language sql as $$
  select public.submit_guard_end_duty(pg_temp.id('end_op'),pg_temp.id('old'),pg_temp.id('successor'),
    'Radio log is in the gate office','Radio',array[]::uuid[],p_time)
$$;

insert into recovery_fixture(key,id) select key,gen_random_uuid() from unnest(array[
  'admin','supervisor','outside','a','b','c','d','site','other','post','old','next','successor','guard_first',
  'historic','historical_op','admin_op','end_op','early_op','ob','incident'
]) key;
insert into auth.users(id) select id from recovery_fixture where key in ('admin','supervisor','outside','a','b','c','d');
insert into public.profiles(id,display_name,role,is_active)
select id,'Recovery '||key, case when key='admin' then 'admin' when key in ('supervisor','outside') then 'supervisor'
  else 'guard' end::public.smartops_role,true
from recovery_fixture where key in ('admin','supervisor','outside','a','b','c','d');
insert into public.sites(id,code,name) values
  (pg_temp.id('site'),'QA5D-SQL','Recovery site'),(pg_temp.id('other'),'QA5D-SQL-OTHER','Other site');
insert into public.security_posts(id,site_id,code,name) values
  (pg_temp.id('post'),pg_temp.id('site'),'GATE','Unconfigured gate');
insert into public.site_assignments(user_id,site_id,role_at_site,valid_from)
select p.id,case when p.id=pg_temp.id('outside') then pg_temp.id('other') else pg_temp.id('site') end,p.role,now()-interval '20 days'
from public.profiles p join recovery_fixture f on f.id=p.id;
insert into public.shifts(id,site_id,guard_id,started_at,ended_at,checked_in_at,status,post,successor_shift_id) values
 (pg_temp.id('successor'),pg_temp.id('site'),pg_temp.id('b'),now()-interval '60 minutes',now()+interval '2 hours',null,'scheduled','Gate',null),
 (pg_temp.id('old'),pg_temp.id('site'),pg_temp.id('a'),now()-interval '4 hours',now()-interval '90 minutes',now()-interval '210 minutes','active','Gate',pg_temp.id('successor')),
 (pg_temp.id('next'),pg_temp.id('site'),pg_temp.id('a'),now()-interval '60 minutes',now()+interval '2 hours',null,'scheduled','Other post',null),
 (pg_temp.id('guard_first'),pg_temp.id('site'),pg_temp.id('c'),now()-interval '4 hours',now()-interval '90 minutes',now()-interval '4 hours','active','Gate',null),
 (pg_temp.id('historic'),pg_temp.id('site'),pg_temp.id('d'),now()-interval '12 days',now()-interval '11 days',now()-interval '12 days','completed','Gate',null);
insert into public.shift_handovers(id,site_id,outgoing_shift_id,outgoing_guard_id,post,notes,equipment,incident_ids,requested_end_at,submitted_at)
values(pg_temp.id('historical_op'),pg_temp.id('site'),pg_temp.id('historic'),pg_temp.id('d'),'Gate','Older checkout','',
  array[]::uuid[],now()-interval '11 days',now()-interval '11 days');

set local role anon;
select pg_temp.reject('anonymous reconciliation denied',$q$select public.reconcile_overdue_duty(null,null,null,null,null)$q$,'42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('supervisor')::text,true);
select pg_temp.reject('supervisor reconciliation denied',$q$select pg_temp.reconcile()$q$,'42501');
select pg_temp.ok('supervisor sees overdue record without permission to reconcile',
  (public.get_roster_shift(pg_temp.id('site'),pg_temp.id('old'))->>'can_reconcile')::boolean=false);
select pg_temp.ok('server schedule counts both overdue duties and missing requirements',
  (public.get_operations_schedule(pg_temp.id('site'))->>'overdue')::integer=2 and
  (public.get_operations_schedule(pg_temp.id('site'))->>'unconfigured_posts')::integer=1);
select pg_temp.reject('direct reconciliation read denied',$q$select * from private.duty_reconciliations$q$,'42501');
select pg_temp.reject('direct shift write denied',$q$update public.shifts set status='completed'$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.id('outside')::text,true);
select pg_temp.reject('cross-site schedule denied',$q$select public.get_operations_schedule(pg_temp.id('site'))$q$,'42501');
select pg_temp.reject('cross-site audit history denied',$q$select public.get_roster_shift(pg_temp.id('site'),pg_temp.id('old'))$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.id('a')::text,true);
select pg_temp.reject('guard reconciliation denied',$q$select pg_temp.reconcile()$q$,'42501');
select pg_temp.reject('next activation blocked by overdue duty',$q$select public.start_guard_duty(pg_temp.id('next'))$q$,'P0001');
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
select pg_temp.ok('assigned administrator is offered reconciliation',
  (public.get_roster_shift(pg_temp.id('site'),pg_temp.id('old'))->>'can_reconcile')::boolean);
select pg_temp.reject('stale expected revision rejected',$q$select pg_temp.reconcile(99)$q$,'PT412');
select pg_temp.reject('whitespace-only reason rejected',$q$select pg_temp.reconcile(1,E' \t\n')$q$,'22023');
select pg_temp.reject('administrator cannot reconcile across sites even with valid IDs',
  $q$select public.reconcile_overdue_duty(gen_random_uuid(),pg_temp.id('other'),pg_temp.id('old'),1,'Reason')$q$,'42501');
update recovery_fixture set receipt=pg_temp.reconcile() where key='admin_op';
select pg_temp.ok('administrative retry yields identical receipt',
  (select receipt from recovery_fixture where key='admin_op')=pg_temp.reconcile());
select pg_temp.reject('changed administrative retry rejected',$q$select pg_temp.reconcile(1,'Different reason')$q$,'PT409');
select pg_temp.ok('administrative closure has unknown checkout and original cutoff',
  exists(select 1 from public.shifts where id=pg_temp.id('old') and status='completed'
    and checked_out_at is null and ended_at=now()-interval '90 minutes' and post='Gate'
    and checked_in_at=now()-interval '210 minutes' and successor_shift_id=pg_temp.id('successor')));
select pg_temp.ok('reconciliation creates no handover',
  not exists(select 1 from public.shift_handovers where outgoing_shift_id=pg_temp.id('old')));
select pg_temp.reject('successor cancellation protected during recovery hold',
  $q$select public.cancel_scheduled_shift(gen_random_uuid(),pg_temp.id('site'),pg_temp.id('successor'),1,'Test cancellation')$q$,'PT423');
savepoint hold_expiry;
reset role;
update private.duty_reconciliations set reconciled_at=now()-interval '8 days' where shift_id=pg_temp.id('old');
set local role authenticated;
select pg_temp.ok('recovery hold expires after seven days when no handover exists',
  (public.cancel_scheduled_shift(gen_random_uuid(),pg_temp.id('site'),pg_temp.id('successor'),1,'Expired recovery hold')->>'status')='cancelled');
rollback to hold_expiry;

select set_config('request.jwt.claim.sub',pg_temp.id('a')::text,true);
select public.start_guard_duty(pg_temp.id('next'));
select pg_temp.ok('next shift activates once reconciliation commits',
  exists(select 1 from public.shifts where id=pg_temp.id('next') and status='active' and checked_in_at is not null));
select pg_temp.reject('invalid late checkout retained for review',$q$select pg_temp.checkout(clock_timestamp()+interval '1 second')$q$,'PT422');
update recovery_fixture set receipt=pg_temp.checkout() where key='end_op';
select pg_temp.ok('late checkout replay yields identical receipt',(select receipt from recovery_fixture where key='end_op')=pg_temp.checkout());
select pg_temp.reject('changed late payload rejected',$q$select pg_temp.checkout(now()-interval '3 hours')$q$,'PT409');
select pg_temp.ok('late checkout preserves the old reporting cutoff and new active shift',
  exists(select 1 from public.shifts where id=pg_temp.id('old') and status='completed'
    and ended_at=now()-interval '90 minutes' and checked_out_at=now()-interval '2 hours' and scheduling_revision=3)
  and exists(select 1 from public.shifts where id=pg_temp.id('next') and status='active' and checked_out_at is null));
select public.submit_ob_entry(pg_temp.id('ob'),pg_temp.id('site'),pg_temp.id('old'),'routine',
  'Still valid within the original reporting window',now()-interval '100 minutes');
select pg_temp.reject('post-cutoff incident still rejected',
  $q$select public.submit_incident(pg_temp.id('incident'),pg_temp.id('site'),pg_temp.id('old'),'other','low',
  'This event is outside the original duty window',now()-interval '80 minutes')$q$,'42501');
select pg_temp.reject('wrong incoming guard cannot acknowledge',$q$select public.receive_guard_handover(pg_temp.id('end_op'))$q$,'42501');
reset role;
-- Advance the hold for this test without changing the database clock.
update private.duty_reconciliations set reconciled_at=now()-interval '8 days' where shift_id=pg_temp.id('old');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
select pg_temp.reject('unacknowledged handover protects the successor past day seven',
  $q$select public.cancel_scheduled_shift(gen_random_uuid(),pg_temp.id('site'),pg_temp.id('successor'),1,'Test cancellation')$q$,'PT423');
select set_config('request.jwt.claim.sub',pg_temp.id('b')::text,true);
select public.receive_guard_handover(pg_temp.id('end_op'));
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
select pg_temp.ok('acknowledgement ends pending protection after recovery hold expiry',
  (public.cancel_scheduled_shift(gen_random_uuid(),pg_temp.id('site'),pg_temp.id('successor'),1,'Acknowledged handover')->>'status')='cancelled');
select set_config('request.jwt.claim.sub',pg_temp.id('supervisor')::text,true);
select pg_temp.ok('site supervisor sees administrative and late guard provenance',
  (public.get_roster_shift(pg_temp.id('site'),pg_temp.id('old'))#>>'{reconciliation,late_checkout_received_at}') is not null);
select set_config('request.jwt.claim.sub',pg_temp.id('c')::text,true);
select public.submit_guard_end_duty(pg_temp.id('early_op'),pg_temp.id('guard_first'),null,'Actual guard checkout','',
  array[]::uuid[],now()-interval '2 hours');
select set_config('request.jwt.claim.sub',pg_temp.id('admin')::text,true);
select pg_temp.reject('genuine overdue checkout wins over later reconciliation',
  $q$select public.reconcile_overdue_duty(gen_random_uuid(),pg_temp.id('site'),pg_temp.id('guard_first'),1,'Already ended')$q$,'PT412');
select set_config('request.jwt.claim.sub',pg_temp.id('d')::text,true);
select pg_temp.ok('aged exact guard retry returns original receipt',
  (public.submit_guard_end_duty(pg_temp.id('historical_op'),pg_temp.id('historic'),null,'Older checkout','',
    array[]::uuid[],now()-interval '11 days')->>'received_at')::timestamptz=now()-interval '11 days');
reset role;
select pg_temp.ok('one audit per committed actor action',
  (select count(*) from public.audit_events where entity_ref=pg_temp.id('old') and actor_id=pg_temp.id('admin') and action='duty.reconciled')=1
  and (select count(*) from public.audit_events where entity_ref=pg_temp.id('old') and actor_id=pg_temp.id('a') and action='duty.late_end_confirmed')=1);
select pg_temp.ok('one real handover with acknowledgement by the assigned incoming guard',
  (select count(*) from public.shift_handovers where outgoing_shift_id=pg_temp.id('old')
    and accepted_by=pg_temp.id('b') and accepted_at is not null)=1);
rollback;
