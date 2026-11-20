begin;
-- Provision through the trusted roster process. Old shifts without a mapped
-- post/successor continue to support existing reporting and manual handover.
alter table public.shifts add column post text check(length(trim(post)) between 1 and 120),
  add column successor_shift_id uuid references public.shifts(id),
  add column checked_in_at timestamptz;
alter table public.shift_handovers add column post text, add column equipment text,
  add column incident_ids uuid[] not null default '{}', add column accepted_by uuid references public.profiles(id);
create unique index handovers_one_per_outgoing on public.shift_handovers(outgoing_shift_id) where post is not null;
alter table public.incidents add column source_occurrence_id uuid unique references public.occurrence_entries(id);

create function public.start_guard_duty(p_shift_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(auth.uid()::text));
 select * into strict s from public.shifts where id=p_shift_id for update;
 if auth.uid() is distinct from s.guard_id or not private.has_site_access(s.site_id,array['guard']::public.smartops_role[])
 or s.status not in ('scheduled','active') or s.started_at>now() or s.ended_at<=now()
 or exists(select from public.shifts where guard_id=s.guard_id and id<>s.id and status='active' and (ended_at is null or ended_at>now()))
 then raise exception 'Shift cannot be started'; end if;
 update public.shifts set status='active',checked_in_at=coalesce(checked_in_at,now()) where id=s.id;
end $$;

create function public.submit_guard_handover(p_id uuid,p_shift_id uuid,p_incoming_shift_id uuid,p_notes text,p_equipment text,p_incident_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.shifts%rowtype; n public.shifts%rowtype; h public.shift_handovers%rowtype;
begin
 select * into strict s from public.shifts where id=p_shift_id for update;
 if auth.uid() is distinct from s.guard_id or not private.has_site_access(s.site_id,array['guard']::public.smartops_role[])
 then raise exception 'Unauthorized handover'; end if;
 select * into h from public.shift_handovers where id=p_id;
 if found then
   if h.outgoing_shift_id<>s.id or h.incoming_shift_id is distinct from p_incoming_shift_id or h.notes is distinct from p_notes
    or h.equipment is distinct from p_equipment or h.incident_ids is distinct from p_incident_ids then raise exception 'Conflicting retry'; end if;
 else
   select * into strict n from public.shifts where id=p_incoming_shift_id for share;
   if s.status<>'active' or s.started_at>now() or s.successor_shift_id is distinct from n.id or n.status not in ('scheduled','active')
    or n.site_id<>s.site_id or n.post is null or n.post is distinct from s.post or n.guard_id=s.guard_id
    or length(trim(coalesce(p_notes,''))) not between 5 and 3000 or length(p_equipment)>3000
    or p_incident_ids is null or cardinality(p_incident_ids)>100
    or exists(select from unnest(p_incident_ids) as ref(id) where not exists
      (select from public.incidents i where i.id=ref.id and i.site_id=s.site_id and i.status not in ('closed','resolved')))
   then raise exception 'Invalid handover assignment or contents'; end if;
   insert into public.shift_handovers(id,site_id,outgoing_shift_id,incoming_shift_id,outgoing_guard_id,incoming_guard_id,
    notes,post,equipment,incident_ids) values(p_id,s.site_id,s.id,n.id,s.guard_id,n.guard_id,p_notes,s.post,p_equipment,p_incident_ids) returning * into h;
   update public.shifts set status='completed',ended_at=least(coalesce(ended_at,now()),now()) where id=s.id;
 end if;
 return jsonb_build_object('id',h.id,'received_at',h.submitted_at);
end $$;

create function public.receive_guard_handover(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h public.shift_handovers%rowtype;
begin
 select * into strict h from public.shift_handovers where id=p_id for update;
 if auth.uid() is null or auth.uid() is distinct from h.incoming_guard_id or
 not private.has_site_access(h.site_id,array['guard']::public.smartops_role[]) then raise exception 'Unauthorized recipient' using errcode='42501'; end if;
 if h.accepted_at is null then
   if not exists(select from public.shifts where id=h.incoming_shift_id and guard_id=auth.uid() and site_id=h.site_id and post=h.post and status in ('scheduled','active','completed'))
   then raise exception 'Assignment changed'; end if;
   update public.shift_handovers set accepted_at=now(),accepted_by=auth.uid() where id=h.id returning * into h;
 end if;
 return jsonb_build_object('id',h.id,'received_at',h.accepted_at);
end $$;

create function public.submit_linked_incident(p_id uuid,p_site_id uuid,p_shift_id uuid,p_category text,p_severity text,p_description text,p_reported_at timestamptz,p_source_occurrence_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.occurrence_entries%rowtype; receipt jsonb;
begin
 select * into strict o from public.occurrence_entries where id=p_source_occurrence_id and author_id=auth.uid()
 and shift_id=p_shift_id and site_id=p_site_id and event_at=p_reported_at for update;
 receipt:=public.submit_incident(p_id,p_site_id,p_shift_id,p_category,p_severity,p_description,p_reported_at);
 update public.incidents set source_occurrence_id=o.id where id=p_id and (source_occurrence_id is null or source_occurrence_id=o.id);
 if not found then raise exception 'Conflicting source occurrence'; end if;
 return receipt;
end $$;
revoke all on function public.start_guard_duty(uuid),public.submit_guard_handover(uuid,uuid,uuid,text,text,uuid[]),public.receive_guard_handover(uuid),public.submit_linked_incident(uuid,uuid,uuid,text,text,text,timestamptz,uuid) from public,anon;
grant execute on function public.start_guard_duty(uuid),public.submit_guard_handover(uuid,uuid,uuid,text,text,uuid[]),public.receive_guard_handover(uuid),public.submit_linked_incident(uuid,uuid,uuid,text,text,text,timestamptz,uuid) to authenticated;
commit;
