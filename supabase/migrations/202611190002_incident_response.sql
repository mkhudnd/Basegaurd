begin;

-- A client-generated update ID makes retries safe after a lost response.
create function public.record_incident_response(
  p_update_id uuid, p_incident_id uuid, p_action text, p_note text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_incident public.incidents%rowtype;
  v_update public.incident_updates%rowtype;
begin
  select * into v_incident from public.incidents where id = p_incident_id for update;
  if v_actor is null or not found or
     not private.has_site_access(v_incident.site_id, array['supervisor','admin']::public.smartops_role[]) then
    raise exception 'Not authorized to review incident' using errcode = '42501';
  end if;
  if p_update_id is null or p_action not in ('progress','resolved') or
     length(trim(coalesce(p_note,''))) not between 2 and 1000 then
    raise exception 'Invalid response' using errcode = '22023';
  end if;
  select * into v_update from public.incident_updates where id = p_update_id;
  if found then
    if v_update.incident_id <> p_incident_id or v_update.author_id <> v_actor or
       v_update.update_type <> p_action or v_update.note <> trim(p_note) then
      raise exception 'Conflicting response retry';
    end if;
  else
    if v_incident.status not in ('acknowledged','in_progress') then
      raise exception 'Incident must be acknowledged and open';
    end if;
    insert into public.incident_updates(id,incident_id,author_id,update_type,note)
      values(p_update_id,p_incident_id,v_actor,p_action,trim(p_note)) returning * into v_update;
    update public.incidents set status = case when p_action='resolved' then 'resolved'::public.smartops_incident_status
      else 'in_progress'::public.smartops_incident_status end where id=p_incident_id;
    insert into public.audit_events(actor_id,site_id,action,entity_ref)
      values(v_actor,v_incident.site_id,'incident.' || p_action,p_incident_id);
  end if;
  return jsonb_build_object('id',v_update.id,'created_at',v_update.created_at);
end $$;

revoke all on function public.record_incident_response(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_incident_response(uuid,uuid,text,text) to authenticated;
commit;
