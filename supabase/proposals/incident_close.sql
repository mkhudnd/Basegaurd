-- REVIEW-ONLY PROPOSAL. Do not apply without an approved rollout and database tests.
begin;

create function public.close_incident(
  p_update_id uuid, p_incident_id uuid, p_note text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_incident public.incidents%rowtype;
  v_update public.incident_updates%rowtype;
begin
  select * into v_incident from public.incidents where id=p_incident_id for update;
  if v_actor is null or not found or
     not private.has_site_access(v_incident.site_id,array['supervisor','admin']::public.smartops_role[]) then
    raise exception 'Not authorized to close incident' using errcode='42501';
  end if;
  if p_update_id is null or length(trim(coalesce(p_note,''))) not between 2 and 1000 then
    raise exception 'Invalid close response' using errcode='22023';
  end if;
  select * into v_update from public.incident_updates where id=p_update_id;
  if found then
    if v_update.incident_id<>p_incident_id or v_update.author_id<>v_actor or
       v_update.update_type<>'closed' or v_update.note<>trim(p_note) then
      raise exception 'Conflicting close retry';
    end if;
  else
    if v_incident.status<>'resolved' then
      raise exception 'Incident must be resolved before closure' using errcode='22023';
    end if;
    insert into public.incident_updates(id,incident_id,author_id,update_type,note)
      values(p_update_id,p_incident_id,v_actor,'closed',trim(p_note)) returning * into v_update;
    update public.incidents set status='closed' where id=p_incident_id;
    insert into public.audit_events(actor_id,site_id,action,entity_ref)
      values(v_actor,v_incident.site_id,'incident.closed',p_incident_id);
  end if;
  return jsonb_build_object('id',v_update.id,'incident_id',p_incident_id,
    'status','closed','created_at',v_update.created_at);
end $$;

revoke all on function public.close_incident(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.close_incident(uuid,uuid,text) to authenticated;

commit;
