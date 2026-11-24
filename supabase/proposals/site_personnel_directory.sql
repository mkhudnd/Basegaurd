-- REVIEW-ONLY PROPOSAL. This file is intentionally outside supabase/migrations/.
-- Do not apply without privacy review, database tests and an approved rollout.
begin;

-- Keep the privileged lookup in the non-exposed schema. It returns only a
-- boolean and always derives the actor from auth.uid().
create function private.can_view_guard_identity(p_guard uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.profiles target
    join public.site_assignments assignment on assignment.user_id=target.id
    where target.id=p_guard and target.role='guard'
      and private.has_site_access(
        assignment.site_id,
        array['supervisor','admin']::public.smartops_role[]
      )
  );
$$;
revoke all on function private.can_view_guard_identity(uuid) from public,anon,authenticated;
grant execute on function private.can_view_guard_identity(uuid) to authenticated;

-- Minimal identity exposure: profiles contains only the operational display
-- name, role, account-active flag and creation timestamp. It contains no email,
-- phone, address, credential or Auth administration data.
create policy profiles_supervisor_site on public.profiles for select to authenticated
using (role='guard' and private.can_view_guard_identity(id));

create policy assignments_supervisor_site on public.site_assignments for select to authenticated
using (
  role_at_site='guard' and
  private.can_view_guard_identity(user_id) and
  private.has_site_access(site_id,array['supervisor','admin']::public.smartops_role[])
);

-- Security invoker is deliberate: RLS on profiles, assignments, sites and
-- shifts remains authoritative. This function performs no writes.
create function public.list_site_personnel(
  p_site_id uuid default null,
  p_search text default null,
  p_account_status text default null,
  p_duty_status text default null,
  p_sort text default 'name_asc',
  p_offset integer default 0,
  p_limit integer default 25
) returns jsonb
language sql stable security invoker set search_path='' as $$
with scope as (
  select
    profile.id,
    profile.display_name,
    profile.role::text,
    profile.is_active as account_active,
    profile.created_at,
    coalesce((
      select array_agg(distinct assignment.site_id order by assignment.site_id)
      from public.site_assignments assignment
      where assignment.user_id=profile.id
        and (p_site_id is null or assignment.site_id=p_site_id)
    ),'{}'::uuid[]) as site_ids,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'site_id',assignment.site_id,
        'site_name',site.name,
        'role_at_site',assignment.role_at_site,
        'valid_from',assignment.valid_from,
        'valid_to',assignment.valid_to,
        'status',case
          when assignment.valid_from>now() then 'scheduled'
          when assignment.valid_to is null or assignment.valid_to>now() then 'active'
          else 'ended'
        end
      ) order by site.name,assignment.valid_from desc)
      from public.site_assignments assignment
      join public.sites site on site.id=assignment.site_id
      where assignment.user_id=profile.id
        and (p_site_id is null or assignment.site_id=p_site_id)
    ),'[]'::jsonb) as assignments,
    case
      when duty.status='active' and duty.presence_status='on_duty' then 'on_duty'
      when duty.status='active' and duty.presence_status='on_break' then 'on_break'
      when duty.status='scheduled' then 'scheduled'
      else 'off_duty'
    end as duty_status,
    duty.site_id as current_site_id,
    duty.post as current_post,
    case when duty.status='active' then duty.started_at end as current_shift_started_at,
    (
      select max(checked.checked_in_at)
      from public.shifts checked
      where checked.guard_id=profile.id
        and checked.checked_in_at is not null
        and (p_site_id is null or checked.site_id=p_site_id)
    ) as last_check_in_at,
    exists(
      select 1 from public.site_assignments current_assignment
      join public.sites current_site on current_site.id=current_assignment.site_id
      where current_assignment.user_id=profile.id and current_site.is_active
        and current_assignment.valid_from<=now()
        and (current_assignment.valid_to is null or current_assignment.valid_to>now())
        and (p_site_id is null or current_assignment.site_id=p_site_id)
    ) as assignment_active
  from public.profiles profile
  left join lateral (
    select shift.site_id,shift.post,shift.started_at,shift.status,shift.presence_status
    from public.shifts shift
    where shift.guard_id=profile.id
      and (p_site_id is null or shift.site_id=p_site_id)
      and shift.status in ('active','scheduled')
      and (shift.ended_at is null or shift.ended_at>now())
    order by (shift.status='active') desc,shift.started_at desc,shift.id
    limit 1
  ) duty on true
  where profile.role='guard' and exists(
    select 1 from public.site_assignments membership
    where membership.user_id=profile.id
      and (p_site_id is null or membership.site_id=p_site_id)
  )
), filtered as (
  select * from scope
  where (p_search is null or display_name ilike '%'||p_search||'%' or id::text ilike '%'||p_search||'%')
    and (p_account_status is null or
      (p_account_status='active' and account_active) or
      (p_account_status='inactive' and not account_active))
    and (p_duty_status is null or duty_status=p_duty_status)
), paged as (
  select * from filtered
  order by
    case when p_sort='name_asc' then lower(display_name) end asc,
    case when p_sort='name_desc' then lower(display_name) end desc,
    case when p_sort='recent_duty_desc' then last_check_in_at end desc nulls last,
    case when p_sort='created_desc' then created_at end desc,
    id
  offset greatest(p_offset,0)
  limit least(greatest(p_limit,1),100)
)
select jsonb_build_object(
  'rows',coalesce((select jsonb_agg(to_jsonb(paged)-'assignment_active') from paged),'[]'::jsonb),
  'count',(select count(*) from filtered),
  'metrics',jsonb_build_object(
    'total',(select count(*) from scope),
    'active_accounts',(select count(*) from scope where account_active),
    'on_duty',(select count(*) from scope where duty_status='on_duty'),
    'active_assignments',(select count(*) from scope where assignment_active)
  )
);
$$;

revoke all on function public.list_site_personnel(uuid,text,text,text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.list_site_personnel(uuid,text,text,text,text,integer,integer)
  to authenticated;

commit;
