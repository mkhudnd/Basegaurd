begin;

-- A handover without a recipient records the end of duty and the coverage gap.
alter table public.shift_handovers add column requested_end_at timestamptz;
create or replace function public.submit_guard_handover(
 p_id uuid,p_shift_id uuid,p_incoming_shift_id uuid,p_notes text,p_equipment text,p_incident_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype; n public.shifts%rowtype; h public.shift_handovers%rowtype;
begin
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
     if n.status not in ('scheduled','active') or n.site_id<>s.site_id or
        n.post is null or n.post is distinct from s.post or n.guard_id=s.guard_id then
       raise exception 'Invalid handover assignment or contents';
     end if;
   end if;
   insert into public.shift_handovers(id,site_id,outgoing_shift_id,incoming_shift_id,outgoing_guard_id,
     incoming_guard_id,notes,post,equipment,incident_ids)
     values(p_id,s.site_id,s.id,p_incoming_shift_id,s.guard_id,n.guard_id,p_notes,s.post,p_equipment,p_incident_ids)
     returning * into h;
   update public.shifts set status='completed',ended_at=least(coalesce(ended_at,now()),now()) where id=s.id;
 end if;
 return jsonb_build_object('id',h.id,'received_at',h.submitted_at);
end $$;

create function public.submit_guard_end_duty(
 p_id uuid,p_shift_id uuid,p_incoming_shift_id uuid,p_notes text,p_equipment text,p_incident_ids uuid[],p_ended_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype; h public.shift_handovers%rowtype; receipt jsonb;
begin
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
   update public.shifts set ended_at=least(coalesce(s.ended_at,p_ended_at),p_ended_at) where id=p_shift_id;
 end if;
 return receipt;
end $$;
revoke all on function public.submit_guard_end_duty(uuid,uuid,uuid,text,text,uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.submit_guard_end_duty(uuid,uuid,uuid,text,text,uuid[],timestamptz) to authenticated;

create function public.guard_handover_recipient(p_shift_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype; recipient_name text;
begin
 select * into s from public.shifts where id=p_shift_id;
 if not found or auth.uid() is distinct from s.guard_id or
    not private.has_site_access(s.site_id,array['guard']::public.smartops_role[]) then
   raise exception 'Not authorized' using errcode='42501';
 end if;
 select p.display_name into recipient_name from public.shifts n join public.profiles p on p.id=n.guard_id
  where n.id=s.successor_shift_id and n.site_id=s.site_id and n.post=s.post and n.guard_id<>s.guard_id;
 return recipient_name;
end $$;
revoke all on function public.guard_handover_recipient(uuid) from public,anon,authenticated;
grant execute on function public.guard_handover_recipient(uuid) to authenticated;
commit;
