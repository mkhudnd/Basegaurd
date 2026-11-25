-- Run as the local fixture administrator with psql -v ON_ERROR_STOP=1.
-- Every fixture and test-only object in this file is rolled back.
begin;

create function pg_temp.check_result(p_name text, p_result boolean) returns void
language plpgsql as $$
begin
  if p_result is distinct from true then raise exception 'FAIL: %', p_name; end if;
  raise notice 'PASS: %', p_name;
end;
$$;

create function pg_temp.expect_error(p_name text, p_sql text, p_state text) returns void
language plpgsql security invoker as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then raise notice 'PASS: %', p_name; return; end if;
    raise exception 'FAIL: % expected %, got %: %', p_name, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % expected % but succeeded', p_name, p_state;
end;
$$;

create temp table fixture (key text primary key, value jsonb not null);
grant select, insert, update on fixture to authenticated;
insert into fixture values
  ('polygon', '{"type":"Polygon","coordinates":[[[31,-18],[32,-18],[32,-17],[31,-18]]]}'),
  ('point', '{"type":"Point","coordinates":[31.8,-17.9]}'),
  ('outside', '{"type":"Point","coordinates":[30,-18]}');

insert into auth.users (id, email) values
  ('4b000000-0000-4000-8000-000000000001','phase4b-admin@example.invalid'),
  ('4b000000-0000-4000-8000-000000000002','phase4b-supervisor@example.invalid'),
  ('4b000000-0000-4000-8000-000000000003','phase4b-guard@example.invalid'),
  ('4b000000-0000-4000-8000-000000000004','phase4b-disabled@example.invalid');
insert into public.profiles (id, display_name, role, is_active) values
  ('4b000000-0000-4000-8000-000000000001','Phase 4B Admin','admin',true),
  ('4b000000-0000-4000-8000-000000000002','Phase 4B Supervisor','supervisor',true),
  ('4b000000-0000-4000-8000-000000000003','Phase 4B Guard','guard',true),
  ('4b000000-0000-4000-8000-000000000004','Phase 4B Disabled Admin','admin',false);

create function pg_temp.cancel_audit() returns trigger language plpgsql as $$
begin
  if new.action = 'site.created' and current_setting('phase4b.fail_audit', true) = 'yes' then
    raise exception 'Simulated audit insert failure' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger phase4b_test_audit before insert on public.audit_events
  for each row execute function pg_temp.cancel_audit();

set local role authenticated;
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000001';
insert into fixture values ('site', public.create_managed_site('4b-primary', 'Phase 4B Primary'));
insert into fixture values ('other', public.create_managed_site('4b-other', 'Phase 4B Other'));
select pg_temp.check_result('admin creates site and receives revision one',
  (select value->>'code'='4B-PRIMARY' and value->>'revision'='1' from fixture where key='site'));
select pg_temp.check_result('creator assignment immediately authorizes operational access',
  exists (select 1 from public.sites where code='4B-PRIMARY'));
set local phase4b.fail_audit = 'yes';
select pg_temp.expect_error('audit failure rolls back site creation',
  $$select public.create_managed_site('4B-ROLLBACK', 'Rollback site')$$,'23514');
set local phase4b.fail_audit = 'no';
reset role;
select pg_temp.check_result('creation left exactly one assignment and audit per site',
  (select count(*)=2 from public.site_assignments where site_id in
    (select (value->>'id')::uuid from fixture where key in ('site','other')))
  and (select count(*)=2 from public.audit_events where site_id in
    (select (value->>'id')::uuid from fixture where key in ('site','other')) and action='site.created')
  and not exists(select 1 from public.sites where code='4B-ROLLBACK'));
select pg_temp.check_result('creation assignments bind the actual administrator',
  (select count(*)=2 from public.site_assignments
   where user_id='4b000000-0000-4000-8000-000000000001' and role_at_site='admin'
     and site_id in (select (value->>'id')::uuid from fixture where key in ('site','other'))));
insert into public.site_assignments (user_id, site_id, role_at_site)
select actors.id, (value->>'id')::uuid, actors.role
from fixture cross join (values
  ('4b000000-0000-4000-8000-000000000002'::uuid,'supervisor'::public.smartops_role),
  ('4b000000-0000-4000-8000-000000000003'::uuid,'guard'::public.smartops_role)
) actors(id,role) where key='site';

set local role authenticated;
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000004';
select pg_temp.expect_error('inactive admin cannot create sites',
  $$select public.create_managed_site('4B-DENIED','Denied site')$$,'42501');
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000002';
select pg_temp.expect_error('supervisor cannot create sites',
  $$select public.create_managed_site('4B-DENIED','Denied site')$$,'42501');
select pg_temp.check_result('supervisor directory is scoped',
  (select count(*)=1 from public.list_managed_sites()));
select pg_temp.check_result('other site returns zero rows',
  not exists (select 1 from public.list_managed_sites((select (value->>'id')::uuid from fixture where key='other'))));
select pg_temp.expect_error('cross-site geography write denied', $$
  select public.save_site_geography((select (value->>'id')::uuid from fixture where key='other'),0,null,null,null)
$$,'42501');
select pg_temp.expect_error('cross-site post creation denied', $$
  select public.create_security_post((select (value->>'id')::uuid from fixture where key='other'),'ZZ','Other gate',null)
$$,'42501');
select pg_temp.expect_error('cross-site site edit denied', $$
  select public.update_managed_site((select (value->>'id')::uuid from fixture where key='other'),1,'Other site',true)
$$,'42501');
select pg_temp.expect_error('direct geography read denied', $$select * from public.site_geography$$,'42501');
select pg_temp.expect_error('direct site write denied', $$update public.sites set name='Unauthorized'$$,'42501');
select pg_temp.expect_error('direct geography write denied', $$insert into public.site_geography(site_id) values(gen_random_uuid())$$,'42501');
select pg_temp.expect_error('direct post write denied', $$update public.security_posts set name='Unauthorized'$$,'42501');
select pg_temp.expect_error('direct assignment bypass denied', $$
  insert into public.site_assignments(user_id,site_id,role_at_site) values(auth.uid(),gen_random_uuid(),'admin')
$$,'42501');
select pg_temp.expect_error('internal audit helper inaccessible', $$
  select private.geo_audit(gen_random_uuid(),'site.created',gen_random_uuid())
$$,'42501');

insert into fixture values ('geography', public.save_site_geography(
  (select (value->>'id')::uuid from fixture where key='site'),0,'Boundary only', null,
  (select value from fixture where key='polygon')));
select pg_temp.check_result('boundary-only site persists and reloads',
  (select row->'center'='null'::jsonb and row->'boundary'=(select value from fixture where key='polygon')
    and row->>'geography_revision'='1'
   from public.list_managed_sites((select (value->>'id')::uuid from fixture where key='site')) as row));
select pg_temp.expect_error('first-write revision cannot overwrite an existing boundary', $$
  select public.save_site_geography((select (value->>'id')::uuid from fixture where key='site'),0,null,null,null)
$$,'PT409');
select pg_temp.check_result('valid centre saves and reloads',
  (public.save_site_geography((select (value->>'id')::uuid from fixture where key='site'),1,'Both configured',
   (select value from fixture where key='point'),(select value from fixture where key='polygon'))->>'geography_revision')='2'
  and (select value->>'center' is null or value->'center'='null'::jsonb from fixture where key='geography'));
select pg_temp.check_result('saved centre GeoJSON is returned on read',
  (select row->'center'=(select value from fixture where key='point')
   from public.list_managed_sites((select (value->>'id')::uuid from fixture where key='site')) as row));

select pg_temp.expect_error(name,format(
  'select public.save_site_geography((select (value->>''id'')::uuid from fixture where key=''site''),2,null,%L::jsonb,%L::jsonb)',
  point, polygon),'22023')
from (values
  ('longitude overflow','{"type":"Point","coordinates":[181,0]}',null),
  ('latitude overflow','{"type":"Point","coordinates":[31,-91]}',null),
  ('3D point','{"type":"Point","coordinates":[31,-18,0]}',null),
  ('non-numeric point','{"type":"Point","coordinates":["31",-18]}',null),
  ('empty point','{"type":"Point","coordinates":[]}',null),
  ('null JSON point','null',null),
  ('wrong geometry type','{"type":"MultiPoint","coordinates":[[31,-18]]}',null),
  ('foreign CRS metadata','{"type":"Point","coordinates":[31,-18],"crs":{}}',null),
  ('unsupported feature wrapper','{"type":"Feature","geometry":{"type":"Point","coordinates":[31,-18]}}',null),
  ('empty polygon',null,'{"type":"Polygon","coordinates":[]}'),
  ('unclosed ring',null,'{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]}'),
  ('3D ring',null,'{"type":"Polygon","coordinates":[[[0,0,0],[1,0,0],[0,1,0],[0,0,0]]]}'),
  ('hole rejected',null,'{"type":"Polygon","coordinates":[[[0,0],[5,0],[0,5],[0,0]],[[1,1],[2,1],[1,2],[1,1]]]}'),
  ('multipolygon rejected',null,'{"type":"MultiPolygon","coordinates":[]}'),
  ('collinear ring',null,'{"type":"Polygon","coordinates":[[[0,0],[1,0],[2,0],[0,0]]]}'),
  ('self-intersection',null,'{"type":"Polygon","coordinates":[[[0,0],[3,3],[0,2],[3,0],[0,0]]]}'),
  ('duplicate consecutive positions',null,'{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,0],[0,1],[0,0]]]}'),
  ('antimeridian edge',null,'{"type":"Polygon","coordinates":[[[179,0],[-179,0],[-179,1],[179,0]]]}')
) cases(name,point,polygon)
union all
select pg_temp.expect_error('oversized GeoJSON', format(
  'select public.save_site_geography((select (value->>''id'')::uuid from fixture where key=''site''),2,null,%L::jsonb,null)',
  jsonb_build_object('type','Point','coordinates',jsonb_build_array(1,2),'oversized',repeat('x',35000))), '22023')
union all
select pg_temp.expect_error('excess ring vertices', format(
  'select public.save_site_geography((select (value->>''id'')::uuid from fixture where key=''site''),2,null,null,%L::jsonb)',
  jsonb_build_object('type','Polygon','coordinates',jsonb_build_array(
    (select jsonb_agg(jsonb_build_array(0,0)) from generate_series(1,258))))), '22023');

insert into fixture values ('post', public.create_security_post(
  (select (value->>'id')::uuid from fixture where key='site'),'4b-gate','Primary gate',
  (select value from fixture where key='outside')));
select pg_temp.check_result('outside post is accepted with warning',
  (select value->'outside_boundary'='true'::jsonb and value->>'code'='4B-GATE' from fixture where key='post'));
select pg_temp.expect_error('site-unique case-normalized post code', $$
  select public.create_security_post((select (value->>'id')::uuid from fixture where key='site'),'4B-GATE','Duplicate gate',null)
$$,'23505');
select pg_temp.check_result('post edit updates label and clears outside warning',
  (public.update_security_post((select (value->>'id')::uuid from fixture where key='site'),
  (select (value->>'id')::uuid from fixture where key='post'),1,'4B-GATE','Updated gate',true,
  (select value from fixture where key='point'))->'outside_boundary')='false'::jsonb);
select pg_temp.expect_error('wrong post-site pair rejected', $$
  select public.update_security_post((select (value->>'id')::uuid from fixture where key='other'),
    (select (value->>'id')::uuid from fixture where key='post'),2,'4B-GATE','Wrong site',false,null)
$$,'42501');
select pg_temp.expect_error('stale post revision rejected', $$
  select public.update_security_post((select (value->>'id')::uuid from fixture where key='site'),
    (select (value->>'id')::uuid from fixture where key='post'),1,'4B-GATE','Stale edit',false,null)
$$,'PT409');
select pg_temp.check_result('post can be deactivated',
  (public.update_security_post((select (value->>'id')::uuid from fixture where key='site'),
  (select (value->>'id')::uuid from fixture where key='post'),2,'4B-GATE','Retired gate',false,null)->'is_active')='false'::jsonb);
select pg_temp.check_result('cross-site post reads are empty',
  not exists(select from public.list_site_security_posts((select (value->>'id')::uuid from fixture where key='other'))));
select pg_temp.expect_error('supervisor cannot deactivate site', $$
  select public.update_managed_site((select (value->>'id')::uuid from fixture where key='site'),1,'Primary site',false)
$$,'42501');
select pg_temp.check_result('supervisor can edit active site metadata',
  public.update_managed_site((select (value->>'id')::uuid from fixture where key='site'),1,'Primary site',true)->>'revision'='2');
select pg_temp.check_result('personnel RPC and guard identity remain available',
  exists(select from jsonb_array_elements(public.list_site_personnel()->'rows') r
    where r->>'id'='4b000000-0000-4000-8000-000000000003'));

reset role;
select pg_temp.expect_error('even a trusted writer cannot move a post between sites', $$
  update public.security_posts set site_id=(select (value->>'id')::uuid from fixture where key='other')
    where id=(select (value->>'id')::uuid from fixture where key='post')
$$,'23514');
insert into public.shifts (id,site_id,guard_id,started_at,ended_at,status)
select '4b000000-0000-4000-8000-000000000010', (value->>'id')::uuid,
  '4b000000-0000-4000-8000-000000000003',now()-interval '1 hour',now()+interval '1 hour','scheduled'
from fixture where key='site';

set local role authenticated;
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000003';
select pg_temp.expect_error('guard cannot create a site',
  $$select public.create_managed_site('4B-DENIED','Denied site')$$,'42501');
select pg_temp.check_result('guard cannot read management geography or posts',
  not exists(select from public.list_managed_sites()) and not exists(select from public.list_site_security_posts(
    (select (value->>'id')::uuid from fixture where key='site'))));
select pg_temp.expect_error('guard cannot write geography', $$
  select public.save_site_geography((select (value->>'id')::uuid from fixture where key='site'),2,null,null,null)
$$,'42501');
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000001';
select pg_temp.expect_error('scheduled shift blocks deactivation', $$
  select public.update_managed_site((select (value->>'id')::uuid from fixture where key='site'),2,'Primary site',false)
$$,'23514');

set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000003';
select public.start_guard_duty('4b000000-0000-4000-8000-000000000010');
select pg_temp.check_result('guard start-duty still records a check-in',
  exists(select from public.shifts where id='4b000000-0000-4000-8000-000000000010'
    and status='active' and checked_in_at is not null));
select pg_temp.check_result('guard incident submission returns a receipt',
  public.submit_incident('4b000000-0000-4000-8000-000000000011',
    (select (value->>'id')::uuid from fixture where key='site'),
    '4b000000-0000-4000-8000-000000000010','other','low','Phase 4B regression report.',now()-interval '1 minute')
    ->>'id'='4b000000-0000-4000-8000-000000000011');
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000001';
select pg_temp.expect_error('active shift and incident block deactivation', $$
  select public.update_managed_site((select (value->>'id')::uuid from fixture where key='site'),2,'Primary site',false)
$$,'23514');
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000003';
select pg_temp.check_result('guard end-duty records handover and returns receipt',
  public.submit_guard_end_duty('4b000000-0000-4000-8000-000000000014',
    '4b000000-0000-4000-8000-000000000010',null,'End of shift regression',null,
    array['4b000000-0000-4000-8000-000000000011']::uuid[],now())
      ->>'id'='4b000000-0000-4000-8000-000000000014');
select pg_temp.check_result('completed shift and handover remain readable to guard',
  exists(select from public.shifts where id='4b000000-0000-4000-8000-000000000010' and status='completed')
  and exists(select from public.shift_handovers where id='4b000000-0000-4000-8000-000000000014'));
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000001';
select pg_temp.expect_error('unresolved incident alone blocks deactivation', $$
  select public.update_managed_site((select (value->>'id')::uuid from fixture where key='site'),2,'Primary site',false)
$$,'23514');
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000002';
select public.acknowledge_incident('4b000000-0000-4000-8000-000000000011','Reviewed');
select public.record_incident_response('4b000000-0000-4000-8000-000000000012',
  '4b000000-0000-4000-8000-000000000011','resolved','Issue resolved');
select pg_temp.check_result('existing incident closure path still works',
  public.close_incident('4b000000-0000-4000-8000-000000000013',
    '4b000000-0000-4000-8000-000000000011','Closure confirmed')->>'status'='closed');
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000001';
select pg_temp.check_result('assigned admin deactivates site after blockers clear',
  public.update_managed_site((select (value->>'id')::uuid from fixture where key='site'),2,'Primary site',false)
   ->>'is_active'='false');
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000002';
select pg_temp.check_result('assigned supervisor can see inactive site but cannot edit',
  (select row->>'is_active'='false' and row->>'can_edit'='false' from public.list_managed_sites() as row));
select pg_temp.expect_error('inactive site geography cannot be edited', $$
  select public.save_site_geography((select (value->>'id')::uuid from fixture where key='site'),2,null,null,null)
$$,'42501');
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000003';
select pg_temp.check_result('inactive site stays invisible to guard operations',
  not exists(select from public.sites where code='4B-PRIMARY') and not exists(select from public.list_managed_sites()));
set local request.jwt.claim.sub = '4b000000-0000-4000-8000-000000000001';
select pg_temp.check_result('assigned admin can reactivate site',
  public.update_managed_site((select (value->>'id')::uuid from fixture where key='site'),3,'Primary site',true)
   ->>'is_active'='true');

set local role anon;
set local request.jwt.claim.sub = '';
select pg_temp.expect_error('anonymous directory rejected', $$select public.list_managed_sites()$$,'42501');
select pg_temp.expect_error('anonymous mutation rejected',
  $$select public.create_managed_site('4B-DENIED','Denied site')$$,'42501');
reset role;

select pg_temp.check_result('audit actor, site, entity and successful change counts match',
  (select count(*)=9 and count(*) filter(where action='site.deactivated'
    and actor_id='4b000000-0000-4000-8000-000000000001' and entity_ref=site_id)=1
    and count(*) filter (where action='security_post.deactivated'
    and actor_id='4b000000-0000-4000-8000-000000000002'
    and entity_ref=(select (value->>'id')::uuid from fixture where key='post'))=1
    from public.audit_events where (action like 'site.%' or action like 'security_post.%')
    and site_id=(select (value->>'id')::uuid from fixture where key='site')));
select pg_temp.check_result('app roles cannot assume executor roles',
  not pg_has_role('authenticated','smartops_geo_manager','MEMBER')
  and not pg_has_role('anon','smartops_geo_interlock','MEMBER'));
select pg_temp.check_result('new geographic tables enforce RLS',
  (select count(*)=2 and bool_and(relrowsecurity) from pg_class
   where oid in ('public.site_geography'::regclass,'public.security_posts'::regclass)));
rollback;
