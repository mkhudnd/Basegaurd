-- Baseguard SmartOps: pilot schema, run only in a NEW, dedicated Supabase project.
-- All operational data used during development must be fictional until pilot approval.
-- IMPORTANT: review with a qualified PostgreSQL/Supabase engineer before production.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$ begin
  create type public.smartops_role as enum ('guard','supervisor','admin');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.smartops_incident_status as enum ('reported','acknowledged','in_progress','resolved','closed');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 2 and 120),
  role public.smartops_role not null default 'guard',
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(code) between 2 and 30),
  name text not null check (length(trim(name)) between 2 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.site_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  site_id uuid not null references public.sites(id),
  role_at_site public.smartops_role not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  check(valid_to is null or valid_to > valid_from)
);
create index if not exists ix_site_assignments_auth on public.site_assignments(user_id,site_id,valid_from,valid_to);
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  guard_id uuid not null references public.profiles(id),
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'active' check (status in ('scheduled','active','completed','cancelled')),
  check(ended_at is null or ended_at > started_at)
);
create index if not exists ix_shifts_guard on public.shifts(guard_id,status,started_at desc);

create sequence if not exists public.smartops_incident_number_seq;
create table if not exists public.occurrence_entries (
  id uuid primary key,
  site_id uuid not null references public.sites(id),
  shift_id uuid not null references public.shifts(id),
  author_id uuid not null references public.profiles(id),
  category text not null check (category in ('routine','visitor','patrol','equipment','other')),
  narrative text not null check (length(trim(narrative)) between 5 and 3000),
  event_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index if not exists ix_ob_site_time on public.occurrence_entries(site_id,event_at desc);
create table if not exists public.occurrence_amendments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.occurrence_entries(id),
  author_id uuid not null references public.profiles(id),
  reason text not null check (length(trim(reason)) between 5 and 500),
  revised_note text not null check (length(trim(revised_note)) between 5 and 3000),
  created_at timestamptz not null default now()
);
create table if not exists public.incidents (
  id uuid primary key,
  public_number text not null unique default ('BG-INC-' || lpad(nextval('public.smartops_incident_number_seq')::text, 6, '0')),
  site_id uuid not null references public.sites(id),
  shift_id uuid not null references public.shifts(id),
  reporter_id uuid not null references public.profiles(id),
  category text not null check (category in ('theft','trespass','violence','fire','medical','equipment','other')),
  severity text not null check (severity in ('low','medium','high','critical')),
  description text not null check (length(trim(description)) between 10 and 3000),
  reported_at timestamptz not null,
  received_at timestamptz not null default now(),
  status public.smartops_incident_status not null default 'reported'
);
create index if not exists ix_incidents_site_time on public.incidents(site_id,received_at desc);
create table if not exists public.incident_updates (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id),
  author_id uuid not null references public.profiles(id),
  update_type text not null check(update_type in ('acknowledged','progress','resolved','closed')),
  note text not null check (length(trim(note)) between 2 and 1000),
  created_at timestamptz not null default now()
);
create table if not exists public.shift_handovers (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  outgoing_shift_id uuid not null references public.shifts(id),
  incoming_shift_id uuid references public.shifts(id),
  outgoing_guard_id uuid not null references public.profiles(id),
  incoming_guard_id uuid references public.profiles(id),
  notes text not null check(length(trim(notes)) between 5 and 3000),
  submitted_at timestamptz not null default now(),
  accepted_at timestamptz
);
create table if not exists public.sync_receipts (
  operation_id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  object_type text not null check (object_type in ('occurrence','incident')),
  object_id uuid not null,
  received_at timestamptz not null default now()
);
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  site_id uuid references public.sites(id),
  action text not null,
  entity_ref uuid,
  created_at timestamptz not null default now()
);

-- Defense in depth: all exposed tables are RLS protected; direct writes never allowed.
alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.site_assignments enable row level security;
alter table public.shifts enable row level security;
alter table public.occurrence_entries enable row level security;
alter table public.occurrence_amendments enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_updates enable row level security;
alter table public.shift_handovers enable row level security;
alter table public.sync_receipts enable row level security;
alter table public.audit_events enable row level security;

-- Helper functions deliberately in NON-exposed schema; execute only by authenticated.
-- SECURITY DEFINER is restricted and does not accept an arbitrary actor ID.
create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active);
$$;
create or replace function private.has_site_access(p_site uuid,p_roles public.smartops_role[])
returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
  select 1 from public.site_assignments a
  join public.profiles p on p.id=a.user_id
  join public.sites s on s.id=a.site_id
  where a.user_id=(select auth.uid()) and a.site_id=p_site
    and p.is_active and s.is_active and a.role_at_site=any(p_roles)
    and a.valid_from<=now() and (a.valid_to is null or a.valid_to>now())
    and a.role_at_site=p.role
 );
$$;
revoke all on function private.is_active_user() from public,anon,authenticated;
revoke all on function private.has_site_access(uuid,public.smartops_role[]) from public,anon,authenticated;
grant usage on schema private to authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.has_site_access(uuid,public.smartops_role[]) to authenticated;

create policy profiles_self on public.profiles for select to authenticated
 using (id=(select auth.uid()) and (select private.is_active_user()));
create policy sites_assigned on public.sites for select to authenticated
 using (private.has_site_access(id, array['guard','supervisor','admin']::public.smartops_role[]));
create policy assignments_self on public.site_assignments for select to authenticated
 using (user_id=(select auth.uid()) and (select private.is_active_user()));
create policy shifts_allowed on public.shifts for select to authenticated
 using ((guard_id=(select auth.uid()) and private.has_site_access(site_id,array['guard']::public.smartops_role[]))
   or private.has_site_access(site_id,array['supervisor','admin']::public.smartops_role[]));
create policy ob_allowed on public.occurrence_entries for select to authenticated
 using ((author_id=(select auth.uid()) and private.has_site_access(site_id,array['guard']::public.smartops_role[]))
    or private.has_site_access(site_id,array['supervisor','admin']::public.smartops_role[]));
create policy amendments_allowed on public.occurrence_amendments for select to authenticated
 using (exists(select 1 from public.occurrence_entries o where o.id=entry_id));
create policy incidents_allowed on public.incidents for select to authenticated
 using ((reporter_id=(select auth.uid()) and private.has_site_access(site_id,array['guard']::public.smartops_role[]))
    or private.has_site_access(site_id,array['supervisor','admin']::public.smartops_role[]));
create policy updates_allowed on public.incident_updates for select to authenticated
 using (exists(select 1 from public.incidents i where i.id=incident_id));
create policy handovers_allowed on public.shift_handovers for select to authenticated
 using ((outgoing_guard_id=(select auth.uid()) and private.has_site_access(site_id,array['guard']::public.smartops_role[]))
    or (incoming_guard_id=(select auth.uid()) and private.has_site_access(site_id,array['guard']::public.smartops_role[]))
    or private.has_site_access(site_id,array['supervisor','admin']::public.smartops_role[]));
-- No policies for sync_receipts or audit_events; neither is directly queryable by clients.

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.sites, public.site_assignments,public.shifts,
 public.occurrence_entries,public.occurrence_amendments,public.incidents,public.incident_updates,
 public.shift_handovers to authenticated;
revoke all on sequence public.smartops_incident_number_seq from anon,authenticated,public;

-- Idempotent guarded submission. Existing UUID replays require matching actor and payload.
create or replace function public.submit_ob_entry(
 p_id uuid,p_site_id uuid,p_shift_id uuid,p_category text,p_narrative text,p_event_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_existing public.occurrence_entries%rowtype; v_rows integer;
begin
 if v_actor is null or not private.has_site_access(p_site_id,array['guard']::public.smartops_role[]) then
   raise exception 'Not authorized for this site' using errcode='42501'; end if;
 if not exists(select 1 from public.shifts sh where sh.id=p_shift_id and sh.site_id=p_site_id
     and sh.guard_id=v_actor and sh.status in ('active','completed') and sh.started_at<=p_event_at
     and (sh.ended_at is null or sh.ended_at>=p_event_at)) then
   raise exception 'No authorized active shift' using errcode='42501'; end if;
 if p_id is null or p_category not in ('routine','visitor','patrol','equipment','other')
     or length(trim(coalesce(p_narrative,''))) not between 5 and 3000
     or p_event_at is null or p_event_at>now()+interval '5 minutes'
     or p_event_at<now()-interval '7 days' then
   raise exception 'Invalid occurrence payload' using errcode='22023'; end if;
 insert into public.occurrence_entries(id,site_id,shift_id,author_id,category,narrative,event_at)
 values(p_id,p_site_id,p_shift_id,v_actor,p_category,trim(p_narrative),p_event_at)
 on conflict(id) do nothing;
 get diagnostics v_rows = row_count;
 select * into v_existing from public.occurrence_entries where id=p_id;
 if not found or v_existing.author_id<>v_actor or v_existing.site_id<>p_site_id
  or v_existing.shift_id<>p_shift_id or v_existing.category<>p_category
  or v_existing.narrative<>trim(p_narrative) or v_existing.event_at<>p_event_at then
  raise exception 'Conflicting operation ID' using errcode='23505'; end if;
 if exists(select 1 from public.sync_receipts r where r.operation_id=p_id
  and (r.actor_id<>v_actor or r.object_type<>'occurrence' or r.object_id<>p_id)) then
    raise exception 'Operation ID already belongs to another record' using errcode='23505'; end if;
 insert into public.sync_receipts(operation_id,actor_id,object_type,object_id)
 values(p_id,v_actor,'occurrence',p_id) on conflict(operation_id) do nothing;
 if v_rows=1 then
  insert into public.audit_events(actor_id,site_id,action,entity_ref) values(v_actor,p_site_id,'ob.submitted',p_id);
 end if;
 return jsonb_build_object('id',v_existing.id,'received_at',v_existing.received_at);
end $$;

create or replace function public.submit_incident(
 p_id uuid,p_site_id uuid,p_shift_id uuid,p_category text,p_severity text,p_description text,p_reported_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_existing public.incidents%rowtype; v_rows integer;
begin
 if v_actor is null or not private.has_site_access(p_site_id,array['guard']::public.smartops_role[]) then
   raise exception 'Not authorized for this site' using errcode='42501'; end if;
 if not exists(select 1 from public.shifts sh where sh.id=p_shift_id and sh.site_id=p_site_id
   and sh.guard_id=v_actor and sh.status in ('active','completed') and sh.started_at<=p_reported_at
   and (sh.ended_at is null or sh.ended_at>=p_reported_at)) then
   raise exception 'No authorized active shift' using errcode='42501'; end if;
 if p_id is null or p_category not in ('theft','trespass','violence','fire','medical','equipment','other')
  or p_severity not in ('low','medium','high','critical')
  or length(trim(coalesce(p_description,''))) not between 10 and 3000
  or p_reported_at is null or p_reported_at>now()+interval '5 minutes'
  or p_reported_at<now()-interval '7 days' then
   raise exception 'Invalid incident payload' using errcode='22023'; end if;
 insert into public.incidents(id,site_id,shift_id,reporter_id,category,severity,description,reported_at)
 values(p_id,p_site_id,p_shift_id,v_actor,p_category,p_severity,trim(p_description),p_reported_at)
 on conflict(id) do nothing;
 get diagnostics v_rows = row_count;
 select * into v_existing from public.incidents where id=p_id;
 if not found or v_existing.reporter_id<>v_actor or v_existing.site_id<>p_site_id
  or v_existing.shift_id<>p_shift_id or v_existing.category<>p_category
  or v_existing.severity<>p_severity or v_existing.description<>trim(p_description)
  or v_existing.reported_at<>p_reported_at then
   raise exception 'Conflicting operation ID' using errcode='23505'; end if;
 if exists(select 1 from public.sync_receipts r where r.operation_id=p_id
  and (r.actor_id<>v_actor or r.object_type<>'incident' or r.object_id<>p_id)) then
    raise exception 'Operation ID already belongs to another record' using errcode='23505'; end if;
 insert into public.sync_receipts(operation_id,actor_id,object_type,object_id)
 values(p_id,v_actor,'incident',p_id) on conflict(operation_id) do nothing;
 if v_rows=1 then
  insert into public.audit_events(actor_id,site_id,action,entity_ref) values(v_actor,p_site_id,'incident.submitted',p_id);
 end if;
 return jsonb_build_object('id',v_existing.id,'public_number',v_existing.public_number,'received_at',v_existing.received_at);
end $$;

create or replace function public.acknowledge_incident(p_incident_id uuid,p_note text default 'Acknowledged by supervisor')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_incident public.incidents%rowtype;
begin
 select * into v_incident from public.incidents where id=p_incident_id for update;
 if not found or not private.has_site_access(v_incident.site_id,array['supervisor','admin']::public.smartops_role[]) then
   raise exception 'Not authorized to review incident' using errcode='42501'; end if;
 if length(trim(coalesce(p_note,''))) not between 2 and 1000 then
   raise exception 'Invalid note' using errcode='22023'; end if;
 if v_incident.status='reported' then
   update public.incidents set status='acknowledged' where id=p_incident_id;
   insert into public.incident_updates(incident_id,author_id,update_type,note)
   values(p_incident_id,v_actor,'acknowledged',trim(p_note));
   insert into public.audit_events(actor_id,site_id,action,entity_ref)
   values(v_actor,v_incident.site_id,'incident.acknowledged',p_incident_id);
 elsif v_incident.status not in ('acknowledged','in_progress','resolved','closed') then
   raise exception 'Invalid incident state' using errcode='22023'; end if;
 return jsonb_build_object('id',p_incident_id,'status',(select status from public.incidents where id=p_incident_id));
end $$;

revoke all on function public.submit_ob_entry(uuid,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.submit_incident(uuid,uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.acknowledge_incident(uuid,text) from public,anon,authenticated;
grant execute on function public.submit_ob_entry(uuid,uuid,uuid,text,text,timestamptz) to authenticated;
grant execute on function public.submit_incident(uuid,uuid,uuid,text,text,text,timestamptz) to authenticated;
grant execute on function public.acknowledge_incident(uuid,text) to authenticated;

-- Provision users, assignments and shifts ONLY with controlled administrator SQL during pilot.
-- Prevent API-exposed table writes: clients are authorized for reads + vetted RPCs only.
