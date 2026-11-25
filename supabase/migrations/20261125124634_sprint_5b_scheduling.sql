-- Phase 5B. Local rollout requires the documented live-booking preflight.
begin;
lock table public.shifts in access exclusive mode;

do $$
begin
  if exists (
    select 1 from public.shifts where status in ('scheduled','active')
      and (not isfinite(started_at) or (ended_at is not null and not isfinite(ended_at)))
  ) or exists (
    select 1 from public.shifts where status='active' group by guard_id having count(*)>1
  ) or exists (
    select 1 from public.shifts a join public.shifts b on a.guard_id=b.guard_id and a.id<b.id
    where a.status in ('scheduled','active') and b.status in ('scheduled','active')
      and tstzrange(a.started_at,a.ended_at,'[)') && tstzrange(b.started_at,b.ended_at,'[)')
  ) then
    raise exception 'Incompatible legacy live bookings. Review before enabling scheduling.' using errcode='23514';
  end if;
  if exists (
    select 1 from public.shifts a join public.shifts b on b.id=a.successor_shift_id
    where a.status in ('scheduled','active') and (
      a.site_id<>b.site_id or a.post is null or a.post is distinct from b.post or a.guard_id=b.guard_id
      or b.status not in ('scheduled','active') or b.started_at<=a.started_at
      or (a.ended_at is not null and b.started_at<a.ended_at)
    )
  ) then
    raise exception 'Incompatible legacy successor commitments. Review before enabling scheduling.' using errcode='23514';
  end if;
end $$;

create schema if not exists scheduling_extensions;
revoke all on schema scheduling_extensions from public, anon, authenticated, service_role;
create extension btree_gist with schema scheduling_extensions;

alter table public.shifts
  add column security_post_id uuid,
  add column qualifying_assignment_id uuid references public.site_assignments(id),
  add column scheduled_start_at timestamptz,
  add column scheduled_end_at timestamptz,
  add column checked_out_at timestamptz,
  add column shift_kind text check (shift_kind in ('day','night','custom')),
  add column scheduling_revision bigint not null default 1 check (scheduling_revision > 0),
  add column cancellation_reason text,
  add constraint shifts_structured_post_fk foreign key (site_id,security_post_id)
    references public.security_posts(site_id,id),
  add constraint shifts_planned_window check (
    (scheduled_start_at is null and scheduled_end_at is null and security_post_id is null and shift_kind is null)
    or (scheduled_start_at is not null and scheduled_end_at is not null and security_post_id is not null
      and shift_kind is not null and isfinite(scheduled_start_at) and isfinite(scheduled_end_at)
      and scheduled_end_at > scheduled_start_at and started_at=scheduled_start_at
      and (status not in ('scheduled','active') or ended_at is not distinct from scheduled_end_at)
      and (status not in ('scheduled','active') or qualifying_assignment_id is not null))
  ),
  add constraint shifts_guard_booking_exclusion exclude using gist (
    guard_id scheduling_extensions.gist_uuid_ops with =,
    tstzrange(coalesce(scheduled_start_at,started_at),coalesce(scheduled_end_at,ended_at),'[)') with &&
  ) where (status in ('scheduled','active'));
create unique index shifts_one_active_per_guard on public.shifts(guard_id) where status='active';
create index shifts_roster_site_time on public.shifts(site_id,started_at,id);
create index shifts_post_bookings on public.shifts(site_id,security_post_id) where security_post_id is not null;
create index shifts_successor_lookup on public.shifts(successor_shift_id) where successor_shift_id is not null;
create index shifts_qualifying_assignment on public.shifts(qualifying_assignment_id) where qualifying_assignment_id is not null;
alter table public.shift_handovers add column security_post_id uuid,
  add constraint handovers_structured_post_fk foreign key (site_id,security_post_id)
    references public.security_posts(site_id,id);
create index handovers_pending_shift on public.shift_handovers(incoming_shift_id)
  where accepted_at is null and incoming_shift_id is not null;

create table private.post_booking_capacity (
  site_id uuid not null,
  post_id uuid not null,
  capacity integer not null check (capacity between 1 and 100),
  revision bigint not null default 1 check (revision > 0),
  primary key(site_id,post_id),
  foreign key(site_id,post_id) references public.security_posts(site_id,id)
);
create table private.post_staffing_requirements (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  post_id uuid not null,
  period tstzrange not null check (
    not isempty(period) and lower_inc(period) and not upper_inc(period)
    and not lower_inf(period) and not upper_inf(period)
    and isfinite(lower(period)) and isfinite(upper(period))
  ),
  required_count integer not null check(required_count between 0 and 100),
  is_active boolean not null default true,
  revision bigint not null default 1 check(revision > 0),
  foreign key(site_id,post_id) references public.security_posts(site_id,id),
  exclude using gist (post_id scheduling_extensions.gist_uuid_ops with =, period with &&)
    where(is_active)
);
create table private.scheduling_receipts (
  operation_id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  site_id uuid not null references public.sites(id),
  action text not null,
  request jsonb not null,
  result jsonb not null
);
alter table private.post_booking_capacity enable row level security;
alter table private.post_staffing_requirements enable row level security;
alter table private.scheduling_receipts enable row level security;
revoke all on private.post_booking_capacity,private.post_staffing_requirements,private.scheduling_receipts
  from public,anon,authenticated,service_role;

grant smartops_geo_manager to current_user with set true;
grant create on schema private to smartops_geo_manager;
grant select on public.shifts to smartops_geo_manager;
grant insert (site_id,guard_id,started_at,ended_at,status,post,successor_shift_id,security_post_id,
  qualifying_assignment_id,scheduled_start_at,scheduled_end_at,shift_kind) on public.shifts to smartops_geo_manager;
grant update (guard_id,started_at,ended_at,status,post,successor_shift_id,security_post_id,
  qualifying_assignment_id,scheduled_start_at,scheduled_end_at,shift_kind,scheduling_revision,cancellation_reason)
  on public.shifts to smartops_geo_manager;
grant select (id,display_name) on public.profiles to smartops_geo_manager;
grant select (id) on public.site_assignments to smartops_geo_manager;
grant select,insert,update on private.post_booking_capacity,private.post_staffing_requirements to smartops_geo_manager;
grant select,insert on private.scheduling_receipts to smartops_geo_manager;
create policy scheduling_managed_shift_read on public.shifts for select to smartops_geo_manager
  using (site_id in (select private.geo_managed_sites()));
create policy scheduling_managed_shift_insert on public.shifts for insert to smartops_geo_manager
  with check (site_id in (select id from public.sites where is_active) and status='scheduled');
create policy scheduling_managed_shift_update on public.shifts for update to smartops_geo_manager
  using (site_id in (select id from public.sites where is_active) and status='scheduled')
  with check (site_id in (select id from public.sites where is_active) and status in ('scheduled','cancelled'));

create policy scheduling_read_capacity on private.post_booking_capacity for select to smartops_geo_manager
  using(site_id in (select private.geo_managed_sites()));
create policy scheduling_insert_capacity on private.post_booking_capacity for insert to smartops_geo_manager
  with check(site_id in (select private.geo_managed_sites(true)));
create policy scheduling_update_capacity on private.post_booking_capacity for update to smartops_geo_manager
  using(site_id in (select private.geo_managed_sites(true)))
  with check(site_id in (select private.geo_managed_sites(true)));
create policy scheduling_read_requirement on private.post_staffing_requirements for select to smartops_geo_manager
  using(site_id in (select private.geo_managed_sites()));
create policy scheduling_insert_requirement on private.post_staffing_requirements for insert to smartops_geo_manager
  with check(site_id in (select private.geo_managed_sites(true)));
create policy scheduling_update_requirement on private.post_staffing_requirements for update to smartops_geo_manager
  using(site_id in (select private.geo_managed_sites(true)))
  with check(site_id in (select private.geo_managed_sites(true)));
create policy scheduling_own_receipt on private.scheduling_receipts for select to smartops_geo_manager
  using(actor_id=(select private.geo_actor()) and site_id in (select private.geo_managed_sites()));
create policy scheduling_new_receipt on private.scheduling_receipts for insert to smartops_geo_manager
  with check(actor_id=(select private.geo_actor()) and site_id in (select private.geo_managed_sites()));
create policy scheduling_audit_insert on public.audit_events for insert to smartops_geo_manager
  with check(actor_id=(select private.geo_actor()) and site_id in (select private.geo_managed_sites())
    and action in ('shift.scheduled','shift.updated','shift.reassigned','shift.cancelled',
      'post.capacity_saved','post.staffing_saved'));

create role smartops_schedule_integrity nologin noinherit nobypassrls;
grant smartops_schedule_integrity to current_user with set true;
grant usage on schema public,private to smartops_schedule_integrity;
grant create on schema private to smartops_schedule_integrity;
grant select (id,role,is_active,display_name) on public.profiles to smartops_schedule_integrity;
grant select (id,site_id,user_id,role_at_site,valid_from,valid_to) on public.site_assignments to smartops_schedule_integrity;
grant select (id,is_active) on public.sites to smartops_schedule_integrity;
grant select (id,site_id,is_active) on public.security_posts to smartops_schedule_integrity;
grant select on public.shifts,public.shift_handovers,private.post_booking_capacity to smartops_schedule_integrity;
create policy schedule_integrity_profiles on public.profiles for select to smartops_schedule_integrity using (true);
create policy schedule_integrity_assignments on public.site_assignments for select to smartops_schedule_integrity using (true);
create policy schedule_integrity_sites on public.sites for select to smartops_schedule_integrity using (true);
create policy schedule_integrity_posts on public.security_posts for select to smartops_schedule_integrity using (true);
create policy schedule_integrity_shifts on public.shifts for select to smartops_schedule_integrity using (true);
create policy schedule_integrity_handovers on public.shift_handovers for select to smartops_schedule_integrity using (true);
create policy schedule_integrity_capacity on private.post_booking_capacity for select to smartops_schedule_integrity using (true);
-- The pilot serializes roster and duty mutations before taking row locks.
create function private.scheduling_lock() returns void language plpgsql set search_path='' as $$
begin
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Scheduling mutations require READ COMMITTED' using errcode='25001';
  end if;
  perform pg_advisory_xact_lock(528104,5);
end $$;
create function private.scheduling_lock_statement() returns trigger language plpgsql set search_path='' as $$
begin
  perform private.scheduling_lock();
  return null;
end $$;
create trigger scheduling_lock_shifts before insert or update or delete on public.shifts
  for each statement execute function private.scheduling_lock_statement();
create trigger scheduling_lock_sites before update of is_active on public.sites
  for each statement execute function private.scheduling_lock_statement();
create trigger scheduling_lock_posts before update of is_active on public.security_posts
  for each statement execute function private.scheduling_lock_statement();
create trigger scheduling_lock_profiles before update of is_active,role on public.profiles
  for each statement execute function private.scheduling_lock_statement();
create trigger scheduling_lock_assignments before update or delete on public.site_assignments
  for each statement execute function private.scheduling_lock_statement();
create trigger scheduling_lock_capacity before insert or update or delete on private.post_booking_capacity
  for each statement execute function private.scheduling_lock_statement();
create trigger scheduling_lock_staffing before insert or update or delete on private.post_staffing_requirements
  for each statement execute function private.scheduling_lock_statement();

create function private.scheduling_assignment(p_site uuid,p_guard uuid,p_start timestamptz,p_end timestamptz)
returns uuid language sql stable security definer set search_path='' as $$
  select a.id from public.site_assignments a join public.profiles p on p.id=a.user_id
  where a.user_id=p_guard and a.site_id=p_site and a.role_at_site='guard'
    and p.role='guard' and p.is_active and a.valid_from<=p_start and (a.valid_to is null or a.valid_to>=p_end)
  order by a.valid_from desc,a.id limit 1
$$;
alter function private.scheduling_assignment(uuid,uuid,timestamptz,timestamptz) owner to smartops_schedule_integrity;

-- At equal timestamps aggregate starts and ends before computing the running total.
create function private.scheduling_peak(p_site uuid,p_post uuid,p_exclude uuid,p_start timestamptz,p_end timestamptz)
returns bigint language sql stable security definer set search_path='' as $$
  with windows as (
    select greatest(scheduled_start_at,p_start) as lo,least(scheduled_end_at,p_end) as hi
      from public.shifts
      where site_id=p_site and security_post_id=p_post and id is distinct from p_exclude
        and status in ('active','scheduled') and scheduled_start_at<p_end and scheduled_end_at>p_start
  ), events as (
    select lo as at,1 as delta from windows union all select hi,-1 from windows
  ), totals as (
    select sum(sum(delta)) over(order by at) as total from events group by at
  )
  select coalesce(max(total),0)::bigint from totals
$$;
alter function private.scheduling_peak(uuid,uuid,uuid,timestamptz,timestamptz) owner to smartops_schedule_integrity;

create function private.scheduling_same_post(a public.shifts,b public.shifts)
returns boolean language sql immutable set search_path='' as $$
  select a.site_id=b.site_id and case
    when a.security_post_id is null and b.security_post_id is null
      then a.post is not null and a.post=b.post
    else a.security_post_id is not null and a.security_post_id=b.security_post_id
  end is true
$$;

create function private.scheduling_successor_valid(a public.shifts,b public.shifts)
returns boolean language sql immutable set search_path='' as $$
  select (a.id<>b.id and a.guard_id<>b.guard_id and b.status in ('scheduled','active')
    and private.scheduling_same_post(a,b) and b.started_at>a.started_at
    and (coalesce(a.scheduled_end_at,a.ended_at) is null or
         b.started_at>=coalesce(a.scheduled_end_at,a.ended_at))) is true
$$;
-- Strict forward order makes a cycle impossible, including through legacy links
-- once the touched edge is validated. Existing untouched legacy edges stay intact.
create function private.scheduling_validate_shift() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  predecessor public.shifts%rowtype;
  successor public.shifts%rowtype;
  max_bookings integer;
  eligibility_changed boolean;
  relation_changed boolean;
begin
  if tg_op='DELETE' then
    if old.security_post_id is not null then
      raise exception 'Structured shift history cannot be deleted' using errcode='23514';
    end if;
    return old;
  end if;
  eligibility_changed := tg_op='INSERT';
  relation_changed := tg_op='INSERT';
  if tg_op='UPDATE' then
    eligibility_changed := (new.site_id,new.guard_id,new.security_post_id,new.qualifying_assignment_id,
      new.scheduled_start_at,new.scheduled_end_at,new.status)
      is distinct from (old.site_id,old.guard_id,old.security_post_id,old.qualifying_assignment_id,
      old.scheduled_start_at,old.scheduled_end_at,old.status);
    relation_changed := (new.site_id,new.guard_id,new.security_post_id,new.post,new.started_at,new.ended_at,
      new.successor_shift_id,new.status)
      is distinct from (old.site_id,old.guard_id,old.security_post_id,old.post,old.started_at,old.ended_at,
      old.successor_shift_id,old.status);
    if new.site_id is distinct from old.site_id then
      raise exception 'Shift site is immutable' using errcode='23514';
    end if;
    if old.status in ('active','completed') or old.checked_in_at is not null then
      if (new.guard_id,new.security_post_id,new.qualifying_assignment_id,new.scheduled_start_at,new.scheduled_end_at,
          new.shift_kind,new.post,new.started_at,new.successor_shift_id)
         is distinct from
         (old.guard_id,old.security_post_id,old.qualifying_assignment_id,old.scheduled_start_at,old.scheduled_end_at,
          old.shift_kind,old.post,old.started_at,old.successor_shift_id)
         or new.status='cancelled' or new.status='scheduled' then
        raise exception 'Duty and its successor commitment are frozen' using errcode='PT423';
      end if;
    end if;
  end if;

  if eligibility_changed and new.security_post_id is not null and new.status in ('scheduled','active') then
    if not exists(select 1 from public.sites where id=new.site_id and is_active) or
      not exists(select 1 from public.security_posts where id=new.security_post_id and site_id=new.site_id and is_active)
    then raise exception 'Active post required for this site' using errcode='PT422'; end if;
    if not exists(
      select 1 from public.site_assignments a join public.profiles p on p.id=a.user_id
      where a.id=new.qualifying_assignment_id and p.id=new.guard_id and a.site_id=new.site_id
        and p.role='guard' and p.is_active and a.role_at_site='guard'
        and a.valid_from<=new.scheduled_start_at and (a.valid_to is null or a.valid_to>=new.scheduled_end_at)
    ) then raise exception 'Guard is not eligible for this interval' using errcode='PT422'; end if;
    select capacity into max_bookings from private.post_booking_capacity
      where (site_id,post_id)=(new.site_id,new.security_post_id);
    if max_bookings is null then raise exception 'Configure post booking capacity first' using errcode='PT422'; end if;
    if private.scheduling_peak(new.site_id,new.security_post_id,new.id,new.scheduled_start_at,new.scheduled_end_at)>=max_bookings then
      raise exception 'Post booking capacity exceeded' using errcode='PT409';
    end if;
  end if;

  if tg_op='UPDATE' and ((relation_changed and new.status in ('active','scheduled')) or eligibility_changed or
      (new.shift_kind,new.cancellation_reason) is distinct from (old.shift_kind,old.cancellation_reason)) then
    new.scheduling_revision := old.scheduling_revision+1;
  end if;

  if relation_changed and new.status in ('scheduled','active') and new.successor_shift_id is not null then
    select * into successor from public.shifts where id=new.successor_shift_id;
    if not found or not private.scheduling_successor_valid(new,successor) then
      raise exception 'Invalid successor for this shift' using errcode='PT422';
    end if;
    if exists (
      with recursive chain(id) as (
        select new.successor_shift_id
        union
        select s.successor_shift_id from chain c join public.shifts s on s.id=c.id where s.successor_shift_id is not null
      ) select 1 from chain where id=new.id
    ) then raise exception 'Invalid successor for this shift' using errcode='PT422'; end if;
  end if;

  if tg_op='UPDATE' and relation_changed then
    for predecessor in select * from public.shifts where successor_shift_id=old.id
      and (status in ('scheduled','active') or exists(select 1 from public.shift_handovers h
         where h.outgoing_shift_id=shifts.id and h.incoming_shift_id=old.id and h.accepted_at is null))
    loop
      if (predecessor.status='active' or predecessor.checked_in_at is not null or exists(
          select 1 from public.shift_handovers h where h.outgoing_shift_id=predecessor.id and h.accepted_at is null
        )) and ((new.guard_id,new.security_post_id,new.post,new.started_at,new.scheduled_end_at)
            is distinct from (old.guard_id,old.security_post_id,old.post,old.started_at,old.scheduled_end_at)
          or new.status='cancelled') then
        raise exception 'Shift is protected by a successor commitment' using errcode='PT423';
      end if;
      if predecessor.status='scheduled' and new.status<>'completed'
        and not private.scheduling_successor_valid(predecessor,new) then
        raise exception 'Update the predecessor link first' using errcode='PT423';
      end if;
    end loop;
  end if;
  return new;
end $$;
alter function private.scheduling_validate_shift() owner to smartops_schedule_integrity;
create trigger scheduling_validate_shift before insert or update or delete on public.shifts
  for each row execute function private.scheduling_validate_shift();

create function private.scheduling_lifecycle() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='profiles' then
    if old.role='guard' and old.is_active and (not new.is_active or new.role<>'guard') and (
      exists(select 1 from public.shifts where guard_id=old.id and status in ('scheduled','active')) or
      exists(select 1 from public.shift_handovers where incoming_guard_id=old.id and accepted_at is null)
    ) then raise exception 'Guard has live scheduling commitments' using errcode='PT423'; end if;
  elsif tg_table_name='security_posts' then
    if old.is_active and not new.is_active and (
      exists(select 1 from public.shifts where site_id=old.site_id and security_post_id=old.id
        and status in ('scheduled','active')) or
      exists(select 1 from public.shift_handovers where site_id=old.site_id and security_post_id=old.id
        and incoming_guard_id is not null and accepted_at is null)
    ) then raise exception 'Post has live scheduling commitments' using errcode='PT423'; end if;
  else
    if old.role_at_site='guard' and (
      tg_op='DELETE' or (new.user_id,new.site_id,new.role_at_site,new.valid_from,new.valid_to)
        is distinct from (old.user_id,old.site_id,old.role_at_site,old.valid_from,old.valid_to)
    ) and (
      exists(select 1 from public.shifts s
        where s.guard_id=old.user_id and s.site_id=old.site_id and s.status in ('active','scheduled')
          and (s.qualifying_assignment_id=old.id or s.qualifying_assignment_id is null)
          and (tg_op='DELETE' or new.user_id<>old.user_id or new.site_id<>old.site_id or new.role_at_site<>'guard'
            or new.valid_from>coalesce(s.scheduled_start_at,s.started_at)
            or (new.valid_to is not null and (coalesce(s.scheduled_end_at,s.ended_at) is null
              or new.valid_to<coalesce(s.scheduled_end_at,s.ended_at)))))
      or exists(select 1 from public.shift_handovers h where h.site_id=old.site_id and h.incoming_guard_id=old.user_id
        and h.accepted_at is null and (tg_op='DELETE' or new.user_id<>old.user_id or new.site_id<>old.site_id
          or new.role_at_site<>'guard' or new.valid_from>old.valid_from or
          (new.valid_to is not null and (old.valid_to is null or new.valid_to<old.valid_to))))
    ) then raise exception 'Assignment has live scheduling commitments' using errcode='PT423'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
alter function private.scheduling_lifecycle() owner to smartops_schedule_integrity;
create trigger scheduling_profile_lifecycle before update of is_active,role on public.profiles
  for each row execute function private.scheduling_lifecycle();
create trigger scheduling_post_lifecycle before update of is_active on public.security_posts
  for each row execute function private.scheduling_lifecycle();
create trigger scheduling_assignment_lifecycle before update or delete on public.site_assignments
  for each row execute function private.scheduling_lifecycle();

create function private.scheduling_capacity_floor() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if private.scheduling_peak(old.site_id,old.post_id,null,statement_timestamp(),'infinity')>0 then
      raise exception 'Capacity is required by existing bookings' using errcode='PT423';
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and (new.site_id,new.post_id) is distinct from (old.site_id,old.post_id) then
    raise exception 'Capacity ownership is immutable' using errcode='23514';
  end if;
  if private.scheduling_peak(new.site_id,new.post_id,null,statement_timestamp(),'infinity')>new.capacity then
    raise exception 'Capacity is below existing bookings' using errcode='PT423';
  end if;
  return new;
end $$;
create trigger scheduling_capacity_floor before insert or update or delete on private.post_booking_capacity
  for each row execute function private.scheduling_capacity_floor();
create function private.scheduling_scope(p_site uuid,p_admin boolean) returns void
language plpgsql stable set search_path='' as $$
begin
  if not exists(select 1 from public.sites where id=p_site and is_active)
     or not exists(select 1 from private.geo_managed_sites(p_admin) x(id) where x.id=p_site) then
    raise exception 'Scheduling site unavailable' using errcode='42501';
  end if;
end $$;

create function private.scheduling_retry(p_op uuid,p_site uuid,p_action text,p_request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare entry private.scheduling_receipts%rowtype;
begin
  if p_op is null then raise exception 'Operation ID is required' using errcode='22023'; end if;
  select * into entry from private.scheduling_receipts where operation_id=p_op;
  if not found then return null; end if;
  if entry.site_id<>p_site or entry.action<>p_action or entry.request<>p_request then
    raise exception 'Conflicting operation ID' using errcode='PT409';
  end if;
  return entry.result;
end $$;

create function private.scheduling_receipt(p_op uuid,p_site uuid,p_action text,p_request jsonb,
  p_id uuid,p_revision bigint,p_status text,p_audit_action text) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb := jsonb_build_object('operation_id',p_op,'id',p_id,'revision',p_revision,
  'status',p_status,'received_at',clock_timestamp());
begin
  insert into public.audit_events(actor_id,site_id,action,entity_ref)
    values(private.geo_actor(),p_site,p_audit_action,p_id);
  insert into private.scheduling_receipts values(p_op,private.geo_actor(),p_site,p_action,p_request,result);
  return result;
exception when unique_violation then
  raise exception 'Conflicting operation ID' using errcode='PT409';
end $$;

create function private.scheduling_save_shift(
  p_operation_id uuid,p_site_id uuid,p_shift_id uuid,p_expected_revision bigint,
  p_guard_id uuid,p_post_id uuid,p_start timestamptz,p_end timestamptz,p_kind text,p_successor_shift_id uuid
) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
  kind text := lower(btrim(p_kind));
  request jsonb := jsonb_build_array(p_shift_id,p_expected_revision,p_guard_id,p_post_id,p_start,p_end,
    kind,p_successor_shift_id);
  existing public.shifts%rowtype;
  saved public.shifts%rowtype;
  saved_label text;
  membership uuid;
  receipt jsonb;
  operation text := case when p_shift_id is null then 'create_shift' else 'update_shift' end;
  audit_action text;
begin
  perform private.scheduling_lock();
  perform private.scheduling_scope(p_site_id,false);
  receipt := private.scheduling_retry(p_operation_id,p_site_id,operation,request);
  if receipt is not null then return receipt; end if;
  if p_shift_id is null then
    if p_expected_revision is distinct from 0 then raise exception 'Stale scheduling revision' using errcode='PT412'; end if;
  else
    select * into existing from public.shifts where id=p_shift_id and site_id=p_site_id;
    if not found then raise exception 'Shift unavailable' using errcode='42501'; end if;
    if existing.scheduling_revision is distinct from p_expected_revision then
      raise exception 'Stale scheduling revision' using errcode='PT412';
    end if;
    if existing.status<>'scheduled' or existing.checked_in_at is not null or existing.started_at<=statement_timestamp() then
      raise exception 'Shift is no longer editable' using errcode='PT423';
    end if;
  end if;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
      or p_start<=statement_timestamp() or p_end<=p_start or kind is null or kind not in ('day','night','custom')
      or p_guard_id is null or p_post_id is null then
    raise exception 'A valid future planned interval, guard, post and shift type are required' using errcode='22023';
  end if;
  select name into saved_label from public.security_posts where site_id=p_site_id and id=p_post_id and is_active;
  if not found then raise exception 'Active post required for this site' using errcode='PT422'; end if;
  membership := private.scheduling_assignment(p_site_id,p_guard_id,p_start,p_end);
  if membership is null then raise exception 'Guard is not eligible for this interval' using errcode='PT422'; end if;
  if existing.id is null then
    insert into public.shifts(site_id,guard_id,started_at,ended_at,status,post,successor_shift_id,
      security_post_id,qualifying_assignment_id,scheduled_start_at,scheduled_end_at,shift_kind)
      values(p_site_id,p_guard_id,p_start,p_end,'scheduled',saved_label,p_successor_shift_id,
        p_post_id,membership,p_start,p_end,kind) returning * into saved;
    audit_action := 'shift.scheduled';
  else
    update public.shifts set guard_id=p_guard_id,started_at=p_start,ended_at=p_end,
      post=case when security_post_id=p_post_id then post else saved_label end,
      successor_shift_id=p_successor_shift_id,security_post_id=p_post_id,qualifying_assignment_id=membership,
      scheduled_start_at=p_start,scheduled_end_at=p_end,shift_kind=kind,
      scheduling_revision=scheduling_revision+1 where id=existing.id returning * into saved;
    audit_action := case when existing.guard_id<>p_guard_id then 'shift.reassigned' else 'shift.updated' end;
  end if;
  return private.scheduling_receipt(p_operation_id,p_site_id,operation,request,saved.id,
    saved.scheduling_revision,saved.status,audit_action);
exception when exclusion_violation then
  raise exception 'Guard is unavailable for this interval' using errcode='PT409';
end $$;

create function private.scheduling_cancel_shift(p_operation_id uuid,p_site_id uuid,p_shift_id uuid,
  p_expected_revision bigint,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  reason text := btrim(p_reason);
  request jsonb := jsonb_build_array(p_shift_id,p_expected_revision,reason);
  saved public.shifts%rowtype;
  receipt jsonb;
begin
  perform private.scheduling_lock();
  perform private.scheduling_scope(p_site_id,false);
  receipt := private.scheduling_retry(p_operation_id,p_site_id,'cancel_shift',request);
  if receipt is not null then return receipt; end if;
  select * into saved from public.shifts where id=p_shift_id and site_id=p_site_id;
  if not found then raise exception 'Shift unavailable' using errcode='42501'; end if;
  if saved.scheduling_revision is distinct from p_expected_revision then
    raise exception 'Stale scheduling revision' using errcode='PT412';
  end if;
  if saved.status<>'scheduled' or saved.checked_in_at is not null then
    raise exception 'Only unchecked-in scheduled shifts can be cancelled' using errcode='PT423';
  end if;
  if reason is null or length(reason) not between 2 and 500 then
    raise exception 'Cancellation reason is required' using errcode='22023';
  end if;
  update public.shifts set status='cancelled',cancellation_reason=reason,scheduling_revision=scheduling_revision+1
    where id=saved.id returning * into saved;
  return private.scheduling_receipt(p_operation_id,p_site_id,'cancel_shift',request,saved.id,
    saved.scheduling_revision,saved.status,'shift.cancelled');
end $$;

create function private.scheduling_save_capacity(p_operation_id uuid,p_site_id uuid,p_post_id uuid,
  p_expected_revision bigint,p_capacity integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  request jsonb := jsonb_build_array(p_post_id,p_expected_revision,p_capacity);
  receipt jsonb;
  old_revision bigint;
  new_revision bigint;
begin
  perform private.scheduling_lock();
  perform private.scheduling_scope(p_site_id,true);
  receipt := private.scheduling_retry(p_operation_id,p_site_id,'capacity',request);
  if receipt is not null then return receipt; end if;
  if not exists(select 1 from public.security_posts where site_id=p_site_id and id=p_post_id and is_active) then
    raise exception 'Active post required for this site' using errcode='PT422';
  end if;
  if p_capacity is null or p_capacity not between 1 and 100 then
    raise exception 'Capacity must be between 1 and 100' using errcode='22023';
  end if;
  select revision into old_revision from private.post_booking_capacity where (site_id,post_id)=(p_site_id,p_post_id);
  if coalesce(old_revision,0) is distinct from p_expected_revision then
    raise exception 'Stale capacity revision' using errcode='PT412';
  end if;
  insert into private.post_booking_capacity(site_id,post_id,capacity) values(p_site_id,p_post_id,p_capacity)
    on conflict(site_id,post_id) do update set capacity=excluded.capacity,revision=post_booking_capacity.revision+1
    returning revision into new_revision;
  return private.scheduling_receipt(p_operation_id,p_site_id,'capacity',request,p_post_id,
    new_revision,'saved','post.capacity_saved');
end $$;

create function private.scheduling_save_staffing(p_operation_id uuid,p_site_id uuid,p_post_id uuid,
  p_requirement_id uuid,p_expected_revision bigint,p_start timestamptz,p_end timestamptz,
  p_required_count integer,p_active boolean) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
  request jsonb := jsonb_build_array(p_post_id,p_requirement_id,p_expected_revision,p_start,p_end,p_required_count,p_active);
  receipt jsonb;
  saved private.post_staffing_requirements%rowtype;
begin
  perform private.scheduling_lock();
  perform private.scheduling_scope(p_site_id,true);
  receipt := private.scheduling_retry(p_operation_id,p_site_id,'staffing',request);
  if receipt is not null then return receipt; end if;
  if not exists(select 1 from public.security_posts where site_id=p_site_id and id=p_post_id and (is_active or not p_active)) then
    raise exception 'Post unavailable' using errcode='PT422';
  end if;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<=p_start
    or p_required_count is null or p_required_count not between 0 and 100 or p_active is null then
    raise exception 'Valid staffing interval and required count are required' using errcode='22023';
  end if;
  if p_requirement_id is null then
    if p_expected_revision is distinct from 0 then raise exception 'Stale staffing revision' using errcode='PT412'; end if;
    insert into private.post_staffing_requirements(site_id,post_id,period,required_count,is_active)
      values(p_site_id,p_post_id,tstzrange(p_start,p_end,'[)'),p_required_count,p_active) returning * into saved;
  else
    select * into saved from private.post_staffing_requirements
      where id=p_requirement_id and (site_id,post_id)=(p_site_id,p_post_id);
    if not found then raise exception 'Staffing requirement unavailable' using errcode='42501'; end if;
    if saved.revision is distinct from p_expected_revision then raise exception 'Stale staffing revision' using errcode='PT412'; end if;
    update private.post_staffing_requirements set period=tstzrange(p_start,p_end,'[)'),
      required_count=p_required_count,is_active=p_active,revision=revision+1 where id=saved.id returning * into saved;
  end if;
  return private.scheduling_receipt(p_operation_id,p_site_id,'staffing',request,saved.id,
    saved.revision,case when saved.is_active then 'active' else 'inactive' end,'post.staffing_saved');
exception when exclusion_violation then
  raise exception 'Staffing requirements overlap for this post' using errcode='PT409';
end $$;
create function private.scheduling_candidates(p_site uuid,p_start timestamptz,p_end timestamptz,
  p_after uuid,p_limit integer) returns table(id uuid,display_name text)
language sql stable security definer set search_path='' as $$
  select p.id,p.display_name from public.profiles p
  where p.role='guard' and p.is_active and (p_after is null or p.id>p_after)
    and exists(select 1 from public.site_assignments a where a.user_id=p.id and a.site_id=p_site
      and a.role_at_site='guard' and a.valid_from<=p_start and (a.valid_to is null or a.valid_to>=p_end))
  order by p.id limit p_limit
$$;
alter function private.scheduling_candidates(uuid,timestamptz,timestamptz,uuid,integer) owner to smartops_schedule_integrity;

create function private.scheduling_window(p_start timestamptz,p_end timestamptz) returns void
language plpgsql immutable set search_path='' as $$
begin
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=p_start or p_end-p_start>interval '31 days' then
    raise exception 'A finite interval of up to 31 days is required' using errcode='22023';
  end if;
end $$;

create function private.scheduling_eligible(p_site_id uuid,p_start timestamptz,p_end timestamptz,
  p_after uuid default null,p_limit integer default 50)
returns table(id uuid,display_name text) language plpgsql stable security definer set search_path='' as $$
begin
  perform private.scheduling_scope(p_site_id,false);
  perform private.scheduling_window(p_start,p_end);
  return query select c.id,c.display_name from private.scheduling_candidates(p_site_id,p_start,p_end,p_after,
    least(greatest(coalesce(p_limit,50),1),100)) c;
end $$;

create function private.scheduling_list(p_site_id uuid,p_start timestamptz,p_end timestamptz,
  p_post_id uuid default null,p_after_start timestamptz default null,p_after_id uuid default null,
  p_limit integer default 50)
returns setof jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.scheduling_scope(p_site_id,false);
  perform private.scheduling_window(p_start,p_end);
  if (p_after_start is null) <> (p_after_id is null) then
    raise exception 'Cursor start and ID must be provided together' using errcode='22023';
  end if;
  return query select to_jsonb(s) from public.shifts s
    where s.site_id=p_site_id and (p_post_id is null or s.security_post_id=p_post_id)
      and s.started_at<p_end and coalesce(s.scheduled_end_at,s.ended_at,'infinity')>p_start
      and (p_after_id is null or (s.started_at,s.id)>(p_after_start,p_after_id))
    order by s.started_at,s.id limit least(greatest(coalesce(p_limit,50),1),100);
end $$;

create function private.scheduling_detail(p_site_id uuid,p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.scheduling_scope(p_site_id,false);
  return (select to_jsonb(s) from public.shifts s where s.site_id=p_site_id and s.id=p_shift_id);
end $$;

create function private.scheduling_coverage(p_site_id uuid,p_start timestamptz,p_end timestamptz,
  p_post_id uuid default null) returns setof jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.scheduling_scope(p_site_id,false);
  perform private.scheduling_window(p_start,p_end);
  return query
  with posts as (
    select p.id,p.name,c.capacity,c.revision as capacity_revision
    from public.security_posts p left join private.post_booking_capacity c
      on (c.site_id,c.post_id)=(p.site_id,p.id)
    where p.site_id=p_site_id and p.is_active and (p_post_id is null or p.id=p_post_id)
  ), bookings as (
    select s.*,case when s.checked_out_at is not null then s.checked_out_at
      when s.status='active' then least(statement_timestamp(),s.ended_at)
      when s.status='completed' then (select max(h.requested_end_at) from public.shift_handovers h
        where h.outgoing_shift_id=s.id) end as attendance_end
    from public.shifts s where s.site_id=p_site_id and s.status<>'cancelled'
      and s.started_at<p_end and coalesce(s.scheduled_end_at,s.ended_at,'infinity')>p_start
  ), requirements as (
    select r.* from private.post_staffing_requirements r join posts p on p.id=r.post_id
    where r.site_id=p_site_id and r.is_active and r.period && tstzrange(p_start,p_end,'[)')
  ), edges as (
    select p.id as post,p_start as at from posts p
    union select p.id,p_end from posts p
    union select p.id,statement_timestamp() from posts p where statement_timestamp()>p_start and statement_timestamp()<p_end
    union select r.post_id,greatest(lower(r.period),p_start) from requirements r
    union select r.post_id,least(upper(r.period),p_end) from requirements r
    union select b.security_post_id,greatest(b.scheduled_start_at,p_start) from bookings b where b.security_post_id is not null
    union select b.security_post_id,least(b.scheduled_end_at,p_end) from bookings b where b.security_post_id is not null
    union select b.security_post_id,b.checked_in_at from bookings b where b.security_post_id is not null and b.checked_in_at between p_start and p_end
    union select b.security_post_id,b.attendance_end from bookings b where b.security_post_id is not null and b.attendance_end between p_start and p_end
    union select p.id,b.started_at from posts p cross join bookings b where b.security_post_id is null and b.started_at between p_start and p_end
    union select p.id,b.ended_at from posts p cross join bookings b where b.security_post_id is null and b.ended_at between p_start and p_end
  ), segments as (
    select post,at as lo,lead(at) over(partition by post order by at) as hi from edges
  ), measures as (
    select p.id,p.name,p.capacity,p.capacity_revision,s.lo,s.hi,r.id as requirement_id,r.revision as requirement_revision,
      lower(r.period) as requirement_start_at,upper(r.period) as requirement_end_at,r.required_count,
      (select count(distinct b.guard_id) from bookings b
        where b.security_post_id=p.id and b.scheduled_start_at<=s.lo and b.scheduled_end_at>s.lo) as planned,
      case when s.lo<statement_timestamp() then (select count(distinct b.guard_id) from bookings b
        where b.security_post_id=p.id and b.checked_in_at<=s.lo and b.attendance_end>s.lo) end as attended,
      exists(select 1 from bookings b where b.security_post_id is null and b.started_at<=s.lo
        and (b.ended_at is null or b.ended_at>s.lo)) as unmapped,
      exists(select 1 from bookings b where b.security_post_id=p.id and b.status='completed'
        and b.checked_in_at<=s.lo and b.attendance_end is null and coalesce(b.ended_at,b.scheduled_end_at)>s.lo) as unknown_checkout
    from posts p join segments s on s.post=p.id left join requirements r on r.post_id=p.id and r.period @> s.lo
    where s.hi is not null and s.lo>=p_start and s.hi<=p_end
  )
  select jsonb_build_object('post_id',m.id,'post_name',m.name,'start_at',m.lo,'end_at',m.hi,
    'booking_capacity',m.capacity,'capacity_revision',coalesce(m.capacity_revision,0),
    'requirement_id',m.requirement_id,'requirement_revision',m.requirement_revision,
    'requirement_start_at',m.requirement_start_at,'requirement_end_at',m.requirement_end_at,
    'required_staffing',m.required_count,'scheduled_personnel',m.planned,'confirmed_attendance',m.attended,
    'planned_gap',case when m.required_count is not null and not m.unmapped then greatest(0,m.required_count-m.planned) end,
    'actual_attendance_gap',case when m.required_count is not null and not m.unmapped
      and not m.unknown_checkout and m.attended is not null then greatest(0,m.required_count-m.attended) end,
    'requirements_configured',m.requirement_id is not null,'legacy_unmapped',m.unmapped,
    'actual_attendance_available',m.attended is not null and not m.unmapped and not m.unknown_checkout)
  from measures m order by m.id,m.lo;
end $$;
grant select (site_id,outgoing_shift_id,requested_end_at) on public.shift_handovers to smartops_geo_manager;
create policy scheduling_managed_handover_read on public.shift_handovers for select to smartops_geo_manager
  using(site_id in (select private.geo_managed_sites()));

alter function private.scheduling_lock_statement() security definer;
alter function private.scheduling_lock_statement() owner to smartops_schedule_integrity;
revoke all on function private.scheduling_assignment(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.scheduling_peak(uuid,uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.scheduling_candidates(uuid,timestamptz,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function private.scheduling_scope(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.scheduling_retry(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.scheduling_receipt(uuid,uuid,text,jsonb,uuid,bigint,text,text) from public,anon,authenticated,service_role;
revoke all on function private.scheduling_window(timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.scheduling_lock() from public,anon,authenticated,service_role;
revoke all on function private.scheduling_lock_statement() from public,anon,authenticated,service_role;
revoke all on function private.scheduling_same_post(public.shifts,public.shifts) from public,anon,authenticated,service_role;
revoke all on function private.scheduling_successor_valid(public.shifts,public.shifts) from public,anon,authenticated,service_role;
revoke all on function private.scheduling_validate_shift() from public,anon,authenticated,service_role;
revoke all on function private.scheduling_lifecycle() from public,anon,authenticated,service_role;
revoke all on function private.scheduling_capacity_floor() from public,anon,authenticated,service_role;
grant execute on function private.scheduling_scope(uuid,boolean) to smartops_geo_manager;
grant execute on function private.scheduling_retry(uuid,uuid,text,jsonb) to smartops_geo_manager;
grant execute on function private.scheduling_receipt(uuid,uuid,text,jsonb,uuid,bigint,text,text) to smartops_geo_manager;
grant execute on function private.scheduling_window(timestamptz,timestamptz) to smartops_geo_manager;
grant execute on function private.scheduling_lock() to smartops_geo_manager;
grant execute on function private.scheduling_assignment(uuid,uuid,timestamptz,timestamptz) to smartops_geo_manager;
grant execute on function private.scheduling_peak(uuid,uuid,uuid,timestamptz,timestamptz) to smartops_geo_manager;
grant execute on function private.scheduling_candidates(uuid,timestamptz,timestamptz,uuid,integer) to smartops_geo_manager;
grant execute on function private.scheduling_same_post(public.shifts,public.shifts) to smartops_schedule_integrity;
grant execute on function private.scheduling_successor_valid(public.shifts,public.shifts) to smartops_schedule_integrity;
grant execute on function private.scheduling_lock() to smartops_schedule_integrity;
alter function private.scheduling_save_shift(uuid,uuid,uuid,bigint,uuid,uuid,timestamptz,timestamptz,text,uuid) owner to smartops_geo_manager;
revoke all on function private.scheduling_save_shift(uuid,uuid,uuid,bigint,uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_save_shift(uuid,uuid,uuid,bigint,uuid,uuid,timestamptz,timestamptz,text,uuid) to authenticated;
create function public.save_scheduled_shift(p_operation_id uuid,p_site_id uuid,p_shift_id uuid,p_expected_revision bigint,p_guard_id uuid,p_post_id uuid,p_start timestamptz,p_end timestamptz,p_kind text,p_successor_shift_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.scheduling_save_shift(p_operation_id,p_site_id,p_shift_id,p_expected_revision,p_guard_id,p_post_id,p_start,p_end,p_kind,p_successor_shift_id)
$$;
revoke all on function public.save_scheduled_shift(uuid,uuid,uuid,bigint,uuid,uuid,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_scheduled_shift(uuid,uuid,uuid,bigint,uuid,uuid,timestamptz,timestamptz,text,uuid) to authenticated;

alter function private.scheduling_cancel_shift(uuid,uuid,uuid,bigint,text) owner to smartops_geo_manager;
revoke all on function private.scheduling_cancel_shift(uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_cancel_shift(uuid,uuid,uuid,bigint,text) to authenticated;
create function public.cancel_scheduled_shift(p_operation_id uuid,p_site_id uuid,p_shift_id uuid,p_expected_revision bigint,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.scheduling_cancel_shift(p_operation_id,p_site_id,p_shift_id,p_expected_revision,p_reason)
$$;
revoke all on function public.cancel_scheduled_shift(uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.cancel_scheduled_shift(uuid,uuid,uuid,bigint,text) to authenticated;

alter function private.scheduling_save_capacity(uuid,uuid,uuid,bigint,integer) owner to smartops_geo_manager;
revoke all on function private.scheduling_save_capacity(uuid,uuid,uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_save_capacity(uuid,uuid,uuid,bigint,integer) to authenticated;
create function public.save_post_booking_capacity(p_operation_id uuid,p_site_id uuid,p_post_id uuid,p_expected_revision bigint,p_capacity integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.scheduling_save_capacity(p_operation_id,p_site_id,p_post_id,p_expected_revision,p_capacity)
$$;
revoke all on function public.save_post_booking_capacity(uuid,uuid,uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.save_post_booking_capacity(uuid,uuid,uuid,bigint,integer) to authenticated;

alter function private.scheduling_save_staffing(uuid,uuid,uuid,uuid,bigint,timestamptz,timestamptz,integer,boolean) owner to smartops_geo_manager;
revoke all on function private.scheduling_save_staffing(uuid,uuid,uuid,uuid,bigint,timestamptz,timestamptz,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_save_staffing(uuid,uuid,uuid,uuid,bigint,timestamptz,timestamptz,integer,boolean) to authenticated;
create function public.save_post_staffing_requirement(p_operation_id uuid,p_site_id uuid,p_post_id uuid,p_requirement_id uuid,p_expected_revision bigint,p_start timestamptz,p_end timestamptz,p_required_count integer,p_active boolean)
returns jsonb language sql security invoker set search_path='' as $$
  select private.scheduling_save_staffing(p_operation_id,p_site_id,p_post_id,p_requirement_id,p_expected_revision,p_start,p_end,p_required_count,p_active)
$$;
revoke all on function public.save_post_staffing_requirement(uuid,uuid,uuid,uuid,bigint,timestamptz,timestamptz,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.save_post_staffing_requirement(uuid,uuid,uuid,uuid,bigint,timestamptz,timestamptz,integer,boolean) to authenticated;

alter function private.scheduling_list(uuid,timestamptz,timestamptz,uuid,timestamptz,uuid,integer) owner to smartops_geo_manager;
revoke all on function private.scheduling_list(uuid,timestamptz,timestamptz,uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_list(uuid,timestamptz,timestamptz,uuid,timestamptz,uuid,integer) to authenticated;
create function public.list_roster(p_site_id uuid,p_start timestamptz,p_end timestamptz,p_post_id uuid default null,p_after_start timestamptz default null,p_after_id uuid default null,p_limit integer default 50)
returns setof jsonb language sql stable security invoker set search_path='' as $$
  select * from private.scheduling_list(p_site_id,p_start,p_end,p_post_id,p_after_start,p_after_id,p_limit)
$$;
revoke all on function public.list_roster(uuid,timestamptz,timestamptz,uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_roster(uuid,timestamptz,timestamptz,uuid,timestamptz,uuid,integer) to authenticated;

alter function private.scheduling_detail(uuid,uuid) owner to smartops_geo_manager;
revoke all on function private.scheduling_detail(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_detail(uuid,uuid) to authenticated;
create function public.get_roster_shift(p_site_id uuid,p_shift_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.scheduling_detail(p_site_id,p_shift_id)
$$;
revoke all on function public.get_roster_shift(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_roster_shift(uuid,uuid) to authenticated;

alter function private.scheduling_eligible(uuid,timestamptz,timestamptz,uuid,integer) owner to smartops_geo_manager;
revoke all on function private.scheduling_eligible(uuid,timestamptz,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_eligible(uuid,timestamptz,timestamptz,uuid,integer) to authenticated;
create function public.list_eligible_guards(p_site_id uuid,p_start timestamptz,p_end timestamptz,p_after uuid default null,p_limit integer default 50)
returns table(id uuid,display_name text) language sql stable security invoker set search_path='' as $$
  select * from private.scheduling_eligible(p_site_id,p_start,p_end,p_after,p_limit)
$$;
revoke all on function public.list_eligible_guards(uuid,timestamptz,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_eligible_guards(uuid,timestamptz,timestamptz,uuid,integer) to authenticated;

alter function private.scheduling_coverage(uuid,timestamptz,timestamptz,uuid) owner to smartops_geo_manager;
revoke all on function private.scheduling_coverage(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_coverage(uuid,timestamptz,timestamptz,uuid) to authenticated;
create function public.get_roster_coverage(p_site_id uuid,p_start timestamptz,p_end timestamptz,p_post_id uuid default null)
returns setof jsonb language sql stable security invoker set search_path='' as $$
  select * from private.scheduling_coverage(p_site_id,p_start,p_end,p_post_id)
$$;
revoke all on function public.get_roster_coverage(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_roster_coverage(uuid,timestamptz,timestamptz,uuid) to authenticated;
-- Preserve the installed client RPC names, argument contracts and receipts.
create or replace function public.start_guard_duty(p_shift_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype;
begin
 perform private.scheduling_lock();
 select * into strict s from public.shifts where id=p_shift_id for update;
 if auth.uid() is distinct from s.guard_id or not private.has_site_access(s.site_id,array['guard']::public.smartops_role[])
 or s.status not in ('scheduled','active') or s.started_at>now() or s.ended_at<=now()
 or exists(select from public.shifts where guard_id=s.guard_id and id<>s.id and status='active')
 then raise exception 'Shift cannot be started'; end if;
 update public.shifts set status='active',checked_in_at=coalesce(checked_in_at,now()) where id=s.id;
end $$;

create or replace function public.set_duty_presence(p_shift_id uuid, p_presence_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
 v_actor uuid := (SELECT auth.uid());
 v_shift public.shifts%rowtype;
BEGIN
 PERFORM private.scheduling_lock();
 IF v_actor IS NULL OR p_shift_id IS NULL OR p_presence_status IS NULL
    OR p_presence_status NOT IN ('on_duty','on_break') THEN
   RAISE EXCEPTION 'Invalid duty status request' USING errcode='22023';
 END IF;
 SELECT * INTO v_shift FROM public.shifts WHERE id=p_shift_id FOR UPDATE;
 IF NOT FOUND OR v_shift.guard_id<>v_actor OR v_shift.status<>'active'
    OR v_shift.started_at>now() OR (v_shift.ended_at IS NOT NULL AND v_shift.ended_at<=now())
    OR NOT private.has_site_access(v_shift.site_id, ARRAY['guard']::public.smartops_role[]) THEN
   RAISE EXCEPTION 'Not authorized to change this active shift' USING errcode='42501';
 END IF;
 IF v_shift.presence_status IS DISTINCT FROM p_presence_status THEN
   UPDATE public.shifts
     SET presence_status=p_presence_status, presence_updated_at=now()
     WHERE id=p_shift_id;
   INSERT INTO public.audit_events(actor_id,site_id,action,entity_ref)
     VALUES(v_actor,v_shift.site_id,
        CASE WHEN p_presence_status='on_break' THEN 'duty.break_started' ELSE 'duty.break_ended' END,
        p_shift_id);
 END IF;
 RETURN (SELECT jsonb_build_object('shift_id',id,'presence_status',presence_status,'presence_updated_at',presence_updated_at)
         FROM public.shifts WHERE id=p_shift_id);
END;
$$;

create or replace function public.submit_guard_handover(
 p_id uuid,p_shift_id uuid,p_incoming_shift_id uuid,p_notes text,p_equipment text,p_incident_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype; n public.shifts%rowtype; h public.shift_handovers%rowtype;
begin
 perform private.scheduling_lock();
 select * into strict s from public.shifts where id=p_shift_id for update;
 if auth.uid() is distinct from s.guard_id or
    not private.has_site_access(s.site_id,array['guard']::public.smartops_role[]) then
   raise exception 'Unauthorized handover' using errcode='42501';
 end if;
 select * into h from public.shift_handovers where id=p_id;
 if found then
   if h.outgoing_shift_id<>s.id or h.incoming_shift_id is distinct from p_incoming_shift_id or
      h.notes is distinct from p_notes or h.equipment is distinct from p_equipment or
      h.incident_ids is distinct from p_incident_ids then
     raise exception 'Conflicting retry';
   end if;
 else
   if s.status<>'active' or s.started_at>=now() or
      s.successor_shift_id is distinct from p_incoming_shift_id or
      length(trim(coalesce(p_notes,''))) not between 5 and 3000 or
      length(coalesce(p_equipment,''))>3000 or p_incident_ids is null or cardinality(p_incident_ids)>100 or
      exists(select from unnest(p_incident_ids) ref(id) where not exists
        (select from public.incidents i where i.id=ref.id and i.site_id=s.site_id)) then
     raise exception 'Invalid handover assignment or contents';
   end if;
   if p_incoming_shift_id is not null then
     select * into strict n from public.shifts where id=p_incoming_shift_id for share;
     if (n.status not in ('scheduled','active') and not (s.security_post_id is not null
          and n.status='completed' and n.checked_in_at is not null)) or n.site_id<>s.site_id or
        not private.scheduling_same_post(s,n) or n.guard_id=s.guard_id then
       raise exception 'Invalid handover assignment or contents';
     end if;
   end if;
   insert into public.shift_handovers(id,site_id,outgoing_shift_id,incoming_shift_id,outgoing_guard_id,
     incoming_guard_id,notes,post,equipment,incident_ids,security_post_id)
     values(p_id,s.site_id,s.id,p_incoming_shift_id,s.guard_id,n.guard_id,p_notes,s.post,p_equipment,p_incident_ids,s.security_post_id)
     returning * into h;
   update public.shifts set status='completed',ended_at=least(coalesce(ended_at,now()),now()) where id=s.id;
 end if;
 return jsonb_build_object('id',h.id,'received_at',h.submitted_at);
end $$;

create or replace function public.submit_guard_end_duty(
 p_id uuid,p_shift_id uuid,p_incoming_shift_id uuid,p_notes text,p_equipment text,p_incident_ids uuid[],p_ended_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype; h public.shift_handovers%rowtype; receipt jsonb;
begin
 perform private.scheduling_lock();
 select * into strict s from public.shifts where id=p_shift_id for update;
 if auth.uid() is distinct from s.guard_id or
    not private.has_site_access(s.site_id,array['guard']::public.smartops_role[]) then
   raise exception 'Unauthorized end duty' using errcode='42501';
 end if;
 if p_ended_at is null or p_ended_at<=s.started_at or p_ended_at>now()+interval '5 minutes'
    or p_ended_at<now()-interval '7 days' then
   raise exception 'Invalid end-duty time';
 end if;
 select * into h from public.shift_handovers where id=p_id;
 if found and h.requested_end_at is distinct from p_ended_at then raise exception 'Conflicting end-duty retry'; end if;
 receipt:=public.submit_guard_handover(p_id,p_shift_id,p_incoming_shift_id,p_notes,p_equipment,p_incident_ids);
 if h.id is null then
   update public.shift_handovers set requested_end_at=p_ended_at where id=p_id;
   update public.shifts set ended_at=least(coalesce(s.ended_at,p_ended_at),p_ended_at),
     checked_out_at=case when s.checked_in_at is null or p_ended_at>=s.checked_in_at then p_ended_at end where id=p_shift_id;
 end if;
 return receipt;
end $$;

create or replace function public.receive_guard_handover(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h public.shift_handovers%rowtype;
begin
 perform private.scheduling_lock();
 select * into strict h from public.shift_handovers where id=p_id for update;
 if auth.uid() is null or auth.uid() is distinct from h.incoming_guard_id or
 not private.has_site_access(h.site_id,array['guard']::public.smartops_role[]) then raise exception 'Unauthorized recipient' using errcode='42501'; end if;
 if h.accepted_at is null then
   if not exists(select from public.shifts where id=h.incoming_shift_id and guard_id=auth.uid() and site_id=h.site_id and (case when h.security_post_id is null then security_post_id is null and post=h.post
      else security_post_id=h.security_post_id end) and status in ('scheduled','active','completed'))
   then raise exception 'Assignment changed'; end if;
   update public.shift_handovers set accepted_at=now(),accepted_by=auth.uid() where id=h.id returning * into h;
 end if;
 return jsonb_build_object('id',h.id,'received_at',h.accepted_at);
end $$;

create or replace function public.guard_handover_recipient(p_shift_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype; recipient_name text;
begin
 select * into s from public.shifts where id=p_shift_id;
 if not found or auth.uid() is distinct from s.guard_id or
    not private.has_site_access(s.site_id,array['guard']::public.smartops_role[]) then
   raise exception 'Not authorized' using errcode='42501';
 end if;
 select p.display_name into recipient_name from public.shifts n join public.profiles p on p.id=n.guard_id
  where n.id=s.successor_shift_id and private.scheduling_same_post(s,n) and n.guard_id<>s.guard_id
    and (n.status in ('scheduled','active') or (s.security_post_id is not null
      and n.status='completed' and n.checked_in_at is not null));
 return recipient_name;
end $$;

create or replace function private.geo_update_site(p_site_id uuid, p_expected_revision bigint, p_name text, p_is_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  old_active boolean;
  current_revision bigint;
  saved jsonb;
begin
  perform private.scheduling_lock();
  select is_active, revision into old_active, current_revision
    from public.sites where id = p_site_id for no key update;
  if not found then raise exception 'Site unavailable' using errcode = '42501'; end if;
  if p_is_active is null then raise exception 'Site state is required' using errcode = '22023'; end if;
  if (not old_active or p_is_active <> old_active)
      and p_site_id not in (select private.geo_managed_sites(true)) then
    raise exception 'Assigned administrator required' using errcode = '42501';
  end if;
  if current_revision is distinct from p_expected_revision then
    raise exception 'Site revision conflict' using errcode = 'PT409';
  end if;
  update public.sites set name = btrim(p_name), is_active = p_is_active, revision = revision + 1
    where id = p_site_id;
  if not found then raise exception 'Site unavailable' using errcode = '42501'; end if;
  perform private.geo_audit(p_site_id, case
    when p_is_active and not old_active then 'site.activated'
    when old_active and not p_is_active then 'site.deactivated'
    else 'site.updated' end, p_site_id);
  select * into strict saved from private.geo_list_sites(p_site_id);
  return saved;
end;
$$;

create or replace function private.geo_update_post(p_site_id uuid, p_post_id uuid, p_expected_revision bigint,
  p_code text, p_name text, p_is_active boolean, p_location jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  previous public.security_posts%rowtype;
  saved jsonb;
begin
  perform private.scheduling_lock();
  perform private.geo_require_active_site(p_site_id);
  select * into previous from public.security_posts
    where site_id = p_site_id and id = p_post_id for no key update;
  if not found then raise exception 'Security post unavailable' using errcode = '42501'; end if;
  if previous.revision is distinct from p_expected_revision then
    raise exception 'Security post revision conflict' using errcode = 'PT409';
  end if;
  update public.security_posts
    set code = upper(btrim(p_code)), name = btrim(p_name), is_active = p_is_active,
        location = private.geo_geometry(p_location, 'Point'), revision = revision + 1,
        updated_at = clock_timestamp()
    where site_id = p_site_id and id = p_post_id;
  if not found then raise exception 'Security post unavailable' using errcode = '42501'; end if;
  perform private.geo_audit(p_site_id, case
    when p_is_active and not previous.is_active then 'security_post.activated'
    when previous.is_active and not p_is_active then 'security_post.deactivated'
    else 'security_post.updated' end, p_post_id);
  select * into strict saved from private.geo_list_posts(p_site_id, p_post_id);
  return saved;
end;
$$;

grant execute on function private.scheduling_lock() to postgres,supabase_admin;
grant execute on function private.scheduling_same_post(public.shifts,public.shifts) to postgres,supabase_admin;
revoke create on schema private from smartops_geo_manager,smartops_schedule_integrity;
revoke smartops_geo_manager,smartops_schedule_integrity from current_user;
commit;
