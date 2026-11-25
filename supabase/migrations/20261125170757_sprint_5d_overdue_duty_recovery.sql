begin;

create table private.duty_reconciliations (
  shift_id uuid primary key references public.shifts(id),
  site_id uuid not null references public.sites(id),
  actor_id uuid not null references public.profiles(id),
  reconciled_at timestamptz not null,
  reason text not null check (char_length(reason) between 1 and 1000)
);
alter table private.duty_reconciliations enable row level security;
revoke all on private.duty_reconciliations from public,anon,authenticated,service_role;
grant select,insert on private.duty_reconciliations to smartops_geo_manager;
grant select on private.duty_reconciliations to smartops_schedule_integrity;
create policy duty_reconciliation_site_read on private.duty_reconciliations for select to smartops_geo_manager
  using (site_id in (select private.geo_managed_sites()));
create policy duty_reconciliation_integrity_read on private.duty_reconciliations for select to smartops_schedule_integrity
  using (true);
create policy duty_reconciliation_admin_insert on private.duty_reconciliations for insert to smartops_geo_manager
  with check (actor_id=(select private.geo_actor()) and site_id in (select private.geo_managed_sites(true)));

create policy duty_reconciliation_shift_update on public.shifts for update to smartops_geo_manager
  using (status='active' and site_id in (select private.geo_managed_sites(true)))
  with check (status='completed' and site_id in (select private.geo_managed_sites(true)));
create policy duty_reconciliation_audit_insert on public.audit_events for insert to smartops_geo_manager
  with check (action='duty.reconciled' and actor_id=(select private.geo_actor())
    and site_id in (select private.geo_managed_sites(true)));

grant smartops_geo_manager,smartops_schedule_integrity to current_user with set true;
grant create on schema private to smartops_geo_manager,smartops_schedule_integrity;
grant select (submitted_at) on public.shift_handovers to smartops_geo_manager;

create function private.reconciled_successor_protected(p_shift_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.shifts predecessor
    join private.duty_reconciliations r on r.shift_id=predecessor.id
    where predecessor.successor_shift_id=p_shift_id
      and statement_timestamp()<r.reconciled_at+interval '168 hours'
      and not exists (
        select 1 from public.shift_handovers h where h.outgoing_shift_id=predecessor.id)
  ) or exists (
    select 1 from public.shift_handovers where incoming_shift_id=p_shift_id and accepted_at is null
  )
$$;
alter function private.reconciled_successor_protected(uuid) owner to smartops_schedule_integrity;
revoke all on function private.reconciled_successor_protected(uuid) from public,anon,authenticated,service_role;
grant execute on function private.reconciled_successor_protected(uuid) to smartops_geo_manager;

create function private.protect_reconciled_duty() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.ended_at is distinct from old.ended_at
      and exists(select 1 from private.duty_reconciliations where shift_id=old.id) then
      raise exception 'Reconciled reporting cutoff is frozen' using errcode='PT423';
    end if;
    if (new.guard_id,new.security_post_id,new.post,new.started_at,
        new.scheduled_start_at,new.scheduled_end_at)
       is not distinct from (old.guard_id,old.security_post_id,old.post,old.started_at,
        old.scheduled_start_at,old.scheduled_end_at)
       and (old.status<>'scheduled' or new.ended_at is not distinct from old.ended_at)
       and new.status<>'cancelled' then
      return new;
    end if;
  end if;

  if private.reconciled_successor_protected(old.id) then
    raise exception 'Shift is protected by a successor commitment' using errcode='PT423';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
alter function private.protect_reconciled_duty() owner to smartops_schedule_integrity;
revoke all on function private.protect_reconciled_duty() from public,anon,authenticated,service_role;
create trigger scheduling_protect_reconciled_duty before update or delete on public.shifts
  for each row execute function private.protect_reconciled_duty();

create function private.scheduling_reconcile_duty(p_operation_id uuid,p_site_id uuid,p_shift_id uuid,
  p_expected_revision bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  reason_text text := btrim(p_reason);
  request jsonb := jsonb_build_array(p_shift_id,p_expected_revision,reason_text);
  receipt jsonb;
  duty public.shifts%rowtype;
  reconciled_time timestamptz;
begin
  perform private.scheduling_lock();
  perform private.scheduling_scope(p_site_id,true);
  receipt := private.scheduling_retry(p_operation_id,p_site_id,'reconcile_duty',request);
  if receipt is not null then return receipt; end if;
  if reason_text is null or reason_text !~ '[^[:space:]]' or char_length(reason_text)>1000 then
    raise exception 'A reconciliation reason of up to 1000 characters is required' using errcode='22023';
  end if;
  -- The scheduling lock covers the read and the conditional UPDATE. A row
  -- lock here would filter completed rows through the UPDATE policy before
  -- we can report their new revision to an authorized administrator.
  select * into duty from public.shifts where site_id=p_site_id and id=p_shift_id;
  if not found then raise exception 'Duty unavailable' using errcode='42501'; end if;
  if duty.scheduling_revision is distinct from p_expected_revision then
    raise exception 'Stale duty revision' using errcode='PT412';
  end if;
  reconciled_time := clock_timestamp();
  if duty.status<>'active' or duty.ended_at is null or not isfinite(duty.ended_at)
    or duty.ended_at>reconciled_time or duty.checked_out_at is not null
    or exists(select 1 from public.shift_handovers h where h.site_id=p_site_id and h.outgoing_shift_id=p_shift_id) then
    raise exception 'Duty is no longer eligible for administrative reconciliation' using errcode='PT423';
  end if;
  insert into private.duty_reconciliations(shift_id,site_id,actor_id,reconciled_at,reason)
    values(duty.id,duty.site_id,private.geo_actor(),reconciled_time,reason_text);
  update public.shifts set status='completed'
    where id=duty.id and status='active' and scheduling_revision=p_expected_revision
    returning scheduling_revision into duty.scheduling_revision;
  if not found then raise exception 'Duty unavailable' using errcode='42501'; end if;
  return private.scheduling_receipt(p_operation_id,p_site_id,'reconcile_duty',request,
    duty.id,duty.scheduling_revision,'completed','duty.reconciled');
end $$;
alter function private.scheduling_reconcile_duty(uuid,uuid,uuid,bigint,text) owner to smartops_geo_manager;
revoke all on function private.scheduling_reconcile_duty(uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_reconcile_duty(uuid,uuid,uuid,bigint,text) to authenticated;
create function public.reconcile_overdue_duty(p_operation_id uuid,p_site_id uuid,p_shift_id uuid,
  p_expected_revision bigint,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.scheduling_reconcile_duty(p_operation_id,p_site_id,p_shift_id,p_expected_revision,p_reason)
$$;
revoke all on function public.reconcile_overdue_duty(uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_overdue_duty(uuid,uuid,uuid,bigint,text) to authenticated;

create or replace function public.submit_guard_end_duty(
  p_id uuid,p_shift_id uuid,p_incoming_shift_id uuid,p_notes text,p_equipment text,p_incident_ids uuid[],p_ended_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.shifts%rowtype;
  n public.shifts%rowtype;
  h public.shift_handovers%rowtype;
  reconciled_time timestamptz;
  server_time timestamptz;
  receipt jsonb;
begin
  perform private.scheduling_lock();
  select * into s from public.shifts where id=p_shift_id for update;
  if not found or auth.uid() is distinct from s.guard_id or
    not private.has_site_access(s.site_id,array['guard']::public.smartops_role[]) then
    raise exception 'Unauthorized end duty' using errcode='42501';
  end if;
  select * into h from public.shift_handovers where id=p_id;
  if found then
    if h.outgoing_shift_id<>s.id or h.outgoing_guard_id<>s.guard_id
      or h.requested_end_at is distinct from p_ended_at or p_ended_at is null
      or h.incoming_shift_id is distinct from p_incoming_shift_id
      or h.notes is distinct from p_notes or h.equipment is distinct from p_equipment
      or h.incident_ids is distinct from p_incident_ids then
      raise exception 'Conflicting end-duty retry' using errcode='PT409';
    end if;
    return jsonb_build_object('id',h.id,'received_at',h.submitted_at);
  end if;

  server_time := clock_timestamp();
  if p_id is null or p_ended_at is null or not isfinite(p_ended_at) or p_ended_at<=s.started_at
    or p_ended_at<s.checked_in_at or p_ended_at>server_time+interval '5 minutes'
    or p_ended_at<server_time-interval '168 hours' then
    raise exception 'Invalid end-duty time. Ask your supervisor to review the saved record.' using errcode='PT422';
  end if;
  if s.status='active' then
    receipt := public.submit_guard_handover(p_id,p_shift_id,p_incoming_shift_id,p_notes,p_equipment,p_incident_ids);
    update public.shift_handovers set requested_end_at=p_ended_at where id=p_id;
    update public.shifts set ended_at=least(coalesce(s.ended_at,p_ended_at),p_ended_at),
      checked_out_at=p_ended_at where id=s.id;
    insert into public.audit_events(actor_id,site_id,action,entity_ref)
      values(s.guard_id,s.site_id,'duty.checkout_confirmed',s.id);
    return receipt;
  end if;

  select reconciled_at into reconciled_time from private.duty_reconciliations where shift_id=s.id;
  if s.status<>'completed' or reconciled_time is null or s.checked_out_at is not null
    or exists(select 1 from public.shift_handovers where outgoing_shift_id=s.id) then
    raise exception 'Duty already closed. Ask your supervisor to review the saved record.' using errcode='PT423';
  end if;
  if p_ended_at>reconciled_time or exists(
    select 1 from public.shifts later where later.guard_id=s.guard_id and later.id<>s.id
      and later.checked_in_at>coalesce(s.checked_in_at,s.started_at)
      and later.checked_in_at<p_ended_at
  ) then
    raise exception 'Checkout conflicts with the duty timeline. Ask your supervisor to review the saved record.' using errcode='PT422';
  end if;
  if s.successor_shift_id is distinct from p_incoming_shift_id or
    char_length(btrim(coalesce(p_notes,''))) not between 5 and 3000 or
    char_length(coalesce(p_equipment,''))>3000 or p_incident_ids is null or cardinality(p_incident_ids)>100 or
    exists(select 1 from unnest(p_incident_ids) ref(id) where not exists(
      select 1 from public.incidents i where i.id=ref.id and i.site_id=s.site_id)) then
    raise exception 'Invalid handover assignment or contents' using errcode='PT422';
  end if;
  if p_incoming_shift_id is not null then
    select * into n from public.shifts where id=p_incoming_shift_id for share;
    if not found or (n.status not in ('scheduled','active') and not (s.security_post_id is not null
      and n.status='completed' and n.checked_in_at is not null)) or n.site_id<>s.site_id
      or not private.scheduling_same_post(s,n) or n.guard_id=s.guard_id then
      raise exception 'Invalid handover assignment or contents' using errcode='PT422';
    end if;
  end if;
  insert into public.shift_handovers(id,site_id,outgoing_shift_id,incoming_shift_id,outgoing_guard_id,
    incoming_guard_id,notes,post,equipment,incident_ids,security_post_id,requested_end_at,submitted_at)
    values(p_id,s.site_id,s.id,p_incoming_shift_id,s.guard_id,n.guard_id,p_notes,s.post,p_equipment,
      p_incident_ids,s.security_post_id,p_ended_at,server_time) returning * into h;
  update public.shifts set checked_out_at=p_ended_at,scheduling_revision=scheduling_revision+1 where id=s.id;
  insert into public.audit_events(actor_id,site_id,action,entity_ref)
    values(s.guard_id,s.site_id,'duty.late_end_confirmed',s.id);
  return jsonb_build_object('id',h.id,'received_at',h.submitted_at);
end $$;
revoke all on function public.submit_guard_end_duty(uuid,uuid,uuid,text,text,uuid[],timestamptz)
  from public,anon,service_role;
grant execute on function public.submit_guard_end_duty(uuid,uuid,uuid,text,text,uuid[],timestamptz) to authenticated;

create or replace function private.scheduling_detail(p_site_id uuid,p_shift_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.scheduling_scope(p_site_id,false);
  return (select to_jsonb(s) || jsonb_build_object(
      'reconciliation', case when r.shift_id is not null then
        jsonb_build_object('actor_id',r.actor_id,'reason',r.reason,'reconciled_at',r.reconciled_at,
          'late_checkout_received_at',(select h.submitted_at from public.shift_handovers h
            where h.site_id=s.site_id and h.outgoing_shift_id=s.id and h.requested_end_at is not null
            order by h.submitted_at,h.outgoing_shift_id limit 1)) end,
      'protected_successor',private.reconciled_successor_protected(s.id),
      'can_reconcile', s.status='active' and s.ended_at is not null and isfinite(s.ended_at)
        and s.ended_at<=statement_timestamp() and s.checked_out_at is null
        and p_site_id in (select private.geo_managed_sites(true))
        and not exists(select 1 from public.shift_handovers h
          where h.site_id=s.site_id and h.outgoing_shift_id=s.id))
    from public.shifts s left join private.duty_reconciliations r on r.shift_id=s.id and r.site_id=s.site_id
    where s.site_id=p_site_id and s.id=p_shift_id);
end $$;

create function private.scheduling_overview(p_site_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  snapshot_time timestamptz := statement_timestamp();
  day_start timestamptz := date_trunc('day',snapshot_time at time zone 'Africa/Harare') at time zone 'Africa/Harare';
  day_end timestamptz := day_start+interval '24 hours';
  upcoming_end timestamptz := day_start+interval '168 hours';
begin
  perform private.scheduling_scope(p_site_id,false);
  return (
    with classified as (
      select s.id,s.site_id,s.guard_id,s.post,s.ended_at,s.checked_in_at,
        coalesce(s.scheduled_start_at,s.started_at) as planned_start,
        (s.scheduled_start_at is not null or s.status='scheduled')
          and coalesce(s.scheduled_start_at,s.started_at)<day_end
          and coalesce(s.scheduled_end_at,s.ended_at,'infinity')>day_start as today,
        case
          when s.status='active' and s.ended_at<=snapshot_time then 'overdue'
          when s.status='scheduled' and s.checked_in_at is null then
            case when s.started_at>snapshot_time then 'upcoming'
              when s.ended_at<=snapshot_time or (s.ended_at is null and s.started_at<day_start) then 'missed'
              else 'awaiting' end
        end as state
      from public.shifts s
      where s.site_id=p_site_id and s.status<>'cancelled' and s.started_at<upcoming_end
        and (s.status='active' or s.checked_in_at>=day_start
          or coalesce(s.scheduled_end_at,s.ended_at,'infinity')>day_start)
    ), relevant as (
      select *, (state in ('awaiting','missed') and today
        or state='missed' and ended_at>=day_start
        or state in ('overdue','upcoming')) as actionable
      from classified
    ), totals as (
      select count(*) filter(where today) as today_scheduled,
        count(*) filter(where checked_in_at>=day_start and checked_in_at<=snapshot_time) as confirmed_check_ins,
        count(*) filter(where actionable and state='upcoming') as upcoming,
        count(*) filter(where actionable and state='awaiting') as awaiting,
        count(*) filter(where actionable and state='missed') as missed,
        count(*) filter(where actionable and state='overdue') as overdue
      from relevant
    ), coverage as (
      select count(distinct x->>'post_id') filter(where (x->>'planned_gap')::integer>0) as planned_gap_posts,
        count(distinct x->>'post_id') filter(where (x->>'actual_attendance_gap')::integer>0) as attendance_gap_posts,
        count(distinct x->>'post_id') filter(where not (x->>'requirements_configured')::boolean) as unconfigured_posts,
        count(distinct x->>'post_id') filter(where (x->>'start_at')::timestamptz<snapshot_time
          and not (x->>'actual_attendance_available')::boolean) as unknown_attendance_posts
      from private.scheduling_coverage(p_site_id,day_start,day_end) x
    )
    select to_jsonb(totals) || to_jsonb(coverage) || jsonb_build_object('as_of',snapshot_time,
      'rows',coalesce((select jsonb_agg(to_jsonb(r) - 'today' - 'actionable'
          order by array_position(array['overdue','missed','awaiting','upcoming'],r.state),r.planned_start,r.id)
        from (select * from relevant where actionable order by
          array_position(array['overdue','missed','awaiting','upcoming'],state),planned_start,id limit 12) r),'[]'::jsonb))
    from totals cross join coverage
  );
end $$;
alter function private.scheduling_overview(uuid) owner to smartops_geo_manager;
revoke all on function private.scheduling_overview(uuid) from public,anon,authenticated,service_role;
grant execute on function private.scheduling_overview(uuid) to authenticated;
create function public.get_operations_schedule(p_site_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.scheduling_overview(p_site_id)
$$;
revoke all on function public.get_operations_schedule(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_operations_schedule(uuid) to authenticated;

revoke create on schema private from smartops_geo_manager,smartops_schedule_integrity;
revoke smartops_geo_manager,smartops_schedule_integrity from current_user;
commit;
