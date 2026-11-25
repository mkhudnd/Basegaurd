SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.can_view_guard_identity (
  p_guard uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.close_incident (
  p_update_id   uuid,
  p_incident_id uuid,
  p_note        text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_incident public.incidents%rowtype;
  v_update public.incident_updates%rowtype;
begin
  select * into v_incident
  from public.incidents
  where id = p_incident_id
  for update;

  if v_actor is null or not found or
     not private.has_site_access(
       v_incident.site_id,
       array['supervisor','admin']::public.smartops_role[]
     ) then
    raise exception 'Not authorized to close incident'
      using errcode = '42501';
  end if;

  if p_update_id is null or
     length(trim(coalesce(p_note,''))) not between 2 and 1000 then
    raise exception 'Invalid close response'
      using errcode = '22023';
  end if;

  select * into v_update
  from public.incident_updates
  where id = p_update_id;

  if found then
    if v_update.incident_id <> p_incident_id or
       v_update.author_id <> v_actor or
       v_update.update_type <> 'closed' or
       v_update.note <> trim(p_note) then
      raise exception 'Conflicting close retry';
    end if;
  else
    if v_incident.status <> 'resolved' then
      raise exception 'Incident must be resolved before closure'
        using errcode = '22023';
    end if;

    insert into public.incident_updates (
      id,
      incident_id,
      author_id,
      update_type,
      note
    )
    values (
      p_update_id,
      p_incident_id,
      v_actor,
      'closed',
      trim(p_note)
    )
    returning * into v_update;

    update public.incidents
    set status = 'closed'
    where id = p_incident_id;

    insert into public.audit_events (
      actor_id,
      site_id,
      action,
      entity_ref
    )
    values (
      v_actor,
      v_incident.site_id,
      'incident.closed',
      p_incident_id
    );
  end if;

  return jsonb_build_object(
    'id', v_update.id,
    'incident_id', p_incident_id,
    'status', 'closed',
    'created_at', v_update.created_at
  );
end $function$;

REVOKE ALL ON FUNCTION "public"."close_incident"(uuid, uuid, text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.list_site_personnel (
  p_site_id        uuid    DEFAULT NULL::uuid,
  p_search         text    DEFAULT NULL::text,
  p_account_status text    DEFAULT NULL::text,
  p_duty_status    text    DEFAULT NULL::text,
  p_sort           text    DEFAULT 'name_asc'::text,
  p_offset         integer DEFAULT 0,
  p_limit          integer DEFAULT 25
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION "public"."list_site_personnel"(uuid, text, text, text, text, integer, integer) FROM PUBLIC, "anon";

CREATE POLICY "profiles_supervisor_site" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING (((ROLE = 'guard'::public.smartops_role) AND private.can_view_guard_identity(id)));

CREATE POLICY "assignments_supervisor_site" ON "public"."site_assignments"
  FOR SELECT
  TO "authenticated"
  USING
    (((role_at_site = 'guard'::public.smartops_role) AND private.can_view_guard_identity(user_id) AND private.has_site_access(site_id, ARRAY['supervisor'::public.smartops_role,
    'admin'::public.smartops_role])));

REVOKE ALL ON FUNCTION "private"."can_view_guard_identity"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_view_guard_identity"(uuid) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."close_incident"(uuid, uuid, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."close_incident"(uuid, uuid, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."close_incident"(uuid, uuid, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."close_incident"(uuid, uuid, text) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."list_site_personnel"(uuid, text, text, text, text, integer, integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_site_personnel"(uuid, text, text, text, text, integer, integer) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_site_personnel"(uuid, text, text, text, text, integer, integer) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."list_site_personnel"(uuid, text, text, text, text, integer, integer) TO "service_role";

