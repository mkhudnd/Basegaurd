-- Phase 4B. Extension objects and internal executors stay outside PostgREST.
create schema geo_extensions;
revoke all on schema geo_extensions from public;
create extension postgis with schema geo_extensions;

create role smartops_geo_manager nologin noinherit nobypassrls;
create role smartops_geo_interlock nologin noinherit nobypassrls;
grant smartops_geo_manager, smartops_geo_interlock to current_user with set true;
grant usage on schema public, private to smartops_geo_manager;
grant usage on schema geo_extensions to smartops_geo_manager;
grant usage on schema public, private to smartops_geo_interlock;

-- Bridge to the Auth schema without granting executors any Auth table access.
create function private.geo_actor() returns uuid
language sql stable security definer set search_path = '' as $$
  select auth.uid()
$$;
revoke all on function private.geo_actor() from public, anon, authenticated, service_role;
grant execute on function private.geo_actor() to smartops_geo_manager;

alter table public.sites add column revision bigint not null default 1 check (revision > 0);

create table public.site_geography (
  site_id uuid primary key references public.sites(id),
  details text check (length(details) <= 2000),
  center geo_extensions.geometry(Point,4326),
  boundary geo_extensions.geometry(Polygon,4326),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default clock_timestamp(),
  check (center is null or (not geo_extensions.st_isempty(center)
    and geo_extensions.st_x(center) between -180 and 180
    and geo_extensions.st_y(center) between -90 and 90)),
  check (boundary is null or (not geo_extensions.st_isempty(boundary)
    and geo_extensions.st_isvalid(boundary, 0)
    and geo_extensions.st_numinteriorrings(boundary) = 0
    and geo_extensions.st_npoints(boundary) between 4 and 257
    and geo_extensions.st_xmin(boundary) >= -180 and geo_extensions.st_xmax(boundary) <= 180
    and geo_extensions.st_ymin(boundary) >= -90 and geo_extensions.st_ymax(boundary) <= 90
    and geo_extensions.st_area(boundary) > 0))
);

create table public.security_posts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  is_active boolean not null default true,
  location geo_extensions.geometry(Point,4326),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default clock_timestamp(),
  unique (site_id, code),
  unique (site_id, id),
  check (location is null or (not geo_extensions.st_isempty(location)
    and geo_extensions.st_x(location) between -180 and 180
    and geo_extensions.st_y(location) between -90 and 90))
);

alter table public.site_geography enable row level security;
alter table public.security_posts enable row level security;
revoke all on public.site_geography, public.security_posts from public, anon, authenticated, service_role;

-- These policies give the executor access only to the caller's own identity
-- and assignments. The API roles cannot assume either executor role.
grant select (id, role, is_active) on public.profiles to smartops_geo_manager;
grant select (user_id, site_id, role_at_site, valid_from, valid_to),
  insert (user_id, site_id, role_at_site) on public.site_assignments to smartops_geo_manager;
create policy geo_actor_profile on public.profiles for select to smartops_geo_manager
  using (id = (select private.geo_actor()) and is_active);
create policy geo_actor_assignments on public.site_assignments for select to smartops_geo_manager
  using (user_id = (select private.geo_actor()));

create function private.geo_is_admin() returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = (select private.geo_actor()) and is_active and role = 'admin'
  )
$$;

create function private.geo_managed_sites(p_admin_only boolean default false) returns setof uuid
language sql stable security invoker set search_path = '' as $$
  select a.site_id
  from public.site_assignments a join public.profiles p on p.id = a.user_id
  where a.user_id = (select private.geo_actor()) and p.is_active and p.role = a.role_at_site
    and (p.role = 'admin' or (not p_admin_only and p.role = 'supervisor'))
    and a.valid_from <= statement_timestamp()
    and (a.valid_to is null or a.valid_to > statement_timestamp())
$$;

create policy geo_create_assignment on public.site_assignments for insert to smartops_geo_manager
  with check (user_id = (select private.geo_actor()) and role_at_site = 'admin'
    and (select private.geo_is_admin()));
grant select (id, code, name, is_active, revision), insert (id, code, name),
  update (name, is_active, revision) on public.sites to smartops_geo_manager;
create policy geo_read_sites on public.sites for select to smartops_geo_manager
  using (id in (select private.geo_managed_sites()));
create policy geo_create_site on public.sites for insert to smartops_geo_manager
  with check ((select private.geo_is_admin()));
create policy geo_update_site on public.sites for update to smartops_geo_manager
  using (id in (select private.geo_managed_sites()))
  with check (id in (select private.geo_managed_sites()));

grant select, insert on public.site_geography, public.security_posts to smartops_geo_manager;
grant update (details, center, boundary, revision, updated_at) on public.site_geography to smartops_geo_manager;
grant update (code, name, location, is_active, revision, updated_at) on public.security_posts to smartops_geo_manager;
create policy geo_read_geography on public.site_geography for select to smartops_geo_manager
  using (site_id in (select private.geo_managed_sites()));
create policy geo_insert_geography on public.site_geography for insert to smartops_geo_manager
  with check (site_id in (select id from public.sites where is_active));
create policy geo_update_geography on public.site_geography for update to smartops_geo_manager
  using (site_id in (select id from public.sites where is_active))
  with check (site_id in (select id from public.sites where is_active));
create policy geo_read_posts on public.security_posts for select to smartops_geo_manager
  using (site_id in (select private.geo_managed_sites()));
create policy geo_insert_posts on public.security_posts for insert to smartops_geo_manager
  with check (site_id in (select id from public.sites where is_active));
create policy geo_update_posts on public.security_posts for update to smartops_geo_manager
  using (site_id in (select id from public.sites where is_active))
  with check (site_id in (select id from public.sites where is_active));

-- Even the executor cannot move a post. The trigger also covers trusted writers.
create function private.geo_post_site_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.site_id is distinct from old.site_id then
    raise exception 'A security post cannot change sites' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger geo_post_site_immutable before update of site_id on public.security_posts
  for each row execute function private.geo_post_site_immutable();

grant insert (actor_id, site_id, action, entity_ref) on public.audit_events to smartops_geo_manager;
grant usage on sequence public.audit_events_id_seq to smartops_geo_manager;
create policy geo_insert_audit on public.audit_events for insert to smartops_geo_manager
  with check (actor_id = (select private.geo_actor()) and site_id in (select private.geo_managed_sites())
    and action in ('site.created','site.updated','site.activated','site.deactivated',
      'site.geography_saved','security_post.created','security_post.updated',
      'security_post.activated','security_post.deactivated'));

-- Operational writers take a shared row lock. A site-state UPDATE takes a
-- conflicting lock and evaluates blockers after acquiring it.
grant select (id, is_active), update (id) on public.sites to smartops_geo_interlock;
grant select (site_id, status) on public.shifts, public.incidents to smartops_geo_interlock;
create policy geo_interlock_site_read on public.sites for select to smartops_geo_interlock using (true);
create policy geo_interlock_site_lock on public.sites for update to smartops_geo_interlock
  using (true) with check (false);
create policy geo_interlock_shift_read on public.shifts for select to smartops_geo_interlock using (true);
create policy geo_interlock_incident_read on public.incidents for select to smartops_geo_interlock using (true);
create index geo_blocking_shifts on public.shifts (site_id) where status in ('scheduled','active');
create index geo_blocking_incidents on public.incidents (site_id) where status not in ('resolved','closed');

create function private.geo_lock_operational_site() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.sites where id = new.site_id and is_active for share;
  if not found then
    raise exception 'Operation requires an active site' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger geo_interlock_open_shift before insert or update of status, site_id on public.shifts
  for each row when (new.status in ('scheduled','active'))
  execute function private.geo_lock_operational_site();
create trigger geo_interlock_open_incident before insert or update of status, site_id on public.incidents
  for each row when (new.status not in ('resolved','closed'))
  execute function private.geo_lock_operational_site();

create function private.geo_check_site_deactivation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A fixed repeatable-read snapshot could predate an operational writer
  -- that acquired the site lock first. The Data API uses READ COMMITTED.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Site deactivation requires READ COMMITTED' using errcode = '25001';
  end if;
  if exists (select 1 from public.shifts where site_id = old.id and status in ('scheduled','active'))
     or exists (select 1 from public.incidents where site_id = old.id and status not in ('resolved','closed')) then
    raise exception 'Site has active or scheduled shifts or unresolved incidents' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger geo_check_site_deactivation before update of is_active on public.sites
  for each row when (old.is_active and not new.is_active)
  execute function private.geo_check_site_deactivation();

grant create on schema private to smartops_geo_interlock;
alter function private.geo_lock_operational_site() owner to smartops_geo_interlock;
alter function private.geo_check_site_deactivation() owner to smartops_geo_interlock;
revoke create on schema private from smartops_geo_interlock;

create function private.geo_validate_position(p_position jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_position) is distinct from 'array' then
    raise exception 'A position must be a longitude/latitude array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_position) <> 2
     or jsonb_typeof(p_position->0) is distinct from 'number'
     or jsonb_typeof(p_position->1) is distinct from 'number' then
    raise exception 'A position requires exactly two numeric ordinates' using errcode = '22023';
  end if;
  if (p_position->>0)::numeric not between -180 and 180
     or (p_position->>1)::numeric not between -90 and 90 then
    raise exception 'Position is outside WGS84 coordinate ranges' using errcode = '22023';
  end if;
end;
$$;

create function private.geo_orientation(ax numeric, ay numeric, bx numeric, by numeric, cx numeric, cy numeric)
returns numeric language sql immutable strict set search_path = '' as $$
  select (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
$$;

create function private.geo_validate_ring(p_ring jsonb) returns void
language plpgsql immutable set search_path = '' as $$
declare
  vertices integer;
  position jsonb;
  x numeric[] := '{}';
  y numeric[] := '{}';
  twice_area numeric := 0;
  i integer;
  j integer;
begin
  if jsonb_typeof(p_ring) is distinct from 'array' then
    raise exception 'The polygon exterior must be an array' using errcode = '22023';
  end if;
  vertices := jsonb_array_length(p_ring);
  if vertices not between 4 and 257 or p_ring->0 is distinct from p_ring->(vertices - 1) then
    raise exception 'The polygon requires 3–256 vertices and an explicit closing position' using errcode = '22023';
  end if;

  for position in select value from jsonb_array_elements(p_ring) loop
    perform private.geo_validate_position(position);
    x := array_append(x, (position->>0)::numeric);
    y := array_append(y, (position->>1)::numeric);
  end loop;

  for i in 1..vertices-1 loop
    if (x[i] = x[i+1] and y[i] = y[i+1]) or abs(x[i+1] - x[i]) > 180 then
      raise exception 'Duplicate positions and antimeridian edges are unsupported' using errcode = '22023';
    end if;
    twice_area := twice_area + x[i] * y[i+1] - y[i] * x[i+1];
    -- An adjacent collinear edge can backtrack onto the preceding edge.
    j := case when i = 1 then vertices - 1 else i - 1 end;
    if private.geo_orientation(x[j], y[j], x[i], y[i], x[i+1], y[i+1]) = 0
       and (x[j] - x[i]) * (x[i+1] - x[i]) + (y[j] - y[i]) * (y[i+1] - y[i]) > 0 then
      raise exception 'The polygon exterior overlaps itself' using errcode = '22023';
    end if;
  end loop;

  for i in 1..vertices-3 loop
    for j in i+2..vertices-1 loop
      continue when i = 1 and j = vertices - 1;
      -- Overlapping bounding boxes and opposite-or-zero orientation detect
      -- crossings, collinear overlaps, and nonadjacent vertex touches.
      if greatest(x[i], x[i+1]) >= least(x[j], x[j+1])
         and greatest(x[j], x[j+1]) >= least(x[i], x[i+1])
         and greatest(y[i], y[i+1]) >= least(y[j], y[j+1])
         and greatest(y[j], y[j+1]) >= least(y[i], y[i+1])
         and sign(private.geo_orientation(x[i], y[i], x[i+1], y[i+1], x[j], y[j]))
           * sign(private.geo_orientation(x[i], y[i], x[i+1], y[i+1], x[j+1], y[j+1])) <= 0
         and sign(private.geo_orientation(x[j], y[j], x[j+1], y[j+1], x[i], y[i]))
           * sign(private.geo_orientation(x[j], y[j], x[j+1], y[j+1], x[i+1], y[i+1])) <= 0 then
        raise exception 'The polygon exterior intersects itself' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if twice_area = 0 then
    raise exception 'The polygon requires nonzero area' using errcode = '22023';
  end if;
end;
$$;

create function private.geo_geometry(p_geojson jsonb, p_type text) returns geo_extensions.geometry
language plpgsql immutable set search_path = '' as $$
declare
  coordinates jsonb;
  shape geo_extensions.geometry;
begin
  if p_geojson is null then return null; end if;
  if octet_length(p_geojson::text) > 32768 or jsonb_typeof(p_geojson) is distinct from 'object' then
    raise exception 'Expected a GeoJSON geometry object of at most 32 KiB' using errcode = '22023';
  end if;
  if p_geojson->>'type' is distinct from p_type or p_geojson - 'type' - 'coordinates' <> '{}'::jsonb then
    raise exception 'Invalid or unsupported GeoJSON geometry' using errcode = '22023';
  end if;
  coordinates := p_geojson->'coordinates';
  if p_type = 'Point' then
    perform private.geo_validate_position(coordinates);
  else
    if jsonb_typeof(coordinates) is distinct from 'array' then
      raise exception 'Expected a polygon with one exterior ring' using errcode = '22023';
    end if;
    if jsonb_array_length(coordinates) <> 1 then
      raise exception 'Exactly one exterior ring is supported' using errcode = '22023';
    end if;
    perform private.geo_validate_ring(coordinates->0);
  end if;

  shape := geo_extensions.st_geomfromgeojson(p_geojson);
  if geo_extensions.st_isempty(shape) or geo_extensions.st_srid(shape) <> 4326
     or geo_extensions.st_ndims(shape) <> 2 or not geo_extensions.st_isvalid(shape, 0)
     or (p_type = 'Polygon' and geo_extensions.st_area(shape) <= 0) then
    raise exception 'Geometry is invalid after conversion to WGS84' using errcode = '22023';
  end if;
  return shape;
end;
$$;

create function private.geo_require_active_site(p_site_id uuid) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.sites where id = p_site_id and is_active for share;
  if not found then
    raise exception 'Site unavailable for geographic management' using errcode = '42501';
  end if;
end;
$$;

create function private.geo_audit(p_site_id uuid, p_action text, p_entity uuid) returns void
language sql security invoker set search_path = '' as $$
  insert into public.audit_events (actor_id, site_id, action, entity_ref)
  values ((select private.geo_actor()), p_site_id, p_action, p_entity)
$$;

create function private.geo_list_sites(p_site_id uuid) returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'code', s.code, 'name', s.name, 'is_active', s.is_active, 'revision', s.revision,
    'details', g.details, 'center', geo_extensions.st_asgeojson(g.center, 15, 0)::jsonb,
    'boundary', geo_extensions.st_asgeojson(g.boundary, 15, 0)::jsonb,
    'geography_revision', coalesce(g.revision, 0), 'geography_updated_at', g.updated_at,
    'can_edit', s.is_active, 'can_manage_status', s.id in (select private.geo_managed_sites(true))
  )
  from public.sites s left join public.site_geography g on g.site_id = s.id
  where p_site_id is null or s.id = p_site_id
  order by s.name, s.id
$$;

create function private.geo_list_posts(p_site_id uuid, p_post_id uuid default null) returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'site_id', p.site_id, 'code', p.code, 'name', p.name, 'is_active', p.is_active,
    'location', geo_extensions.st_asgeojson(p.location, 15, 0)::jsonb,
    'revision', p.revision, 'updated_at', p.updated_at,
    'outside_boundary', case when g.boundary is not null and p.location is not null
      then not geo_extensions.st_covers(g.boundary, p.location) end
  )
  from public.security_posts p left join public.site_geography g on g.site_id = p.site_id
  where p.site_id = p_site_id and (p_post_id is null or p.id = p_post_id)
  order by p.code, p.id
$$;

create function private.geo_create_site(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  site_id uuid := gen_random_uuid();
  saved jsonb;
begin
  if not private.geo_is_admin() then
    raise exception 'An active administrator is required' using errcode = '42501';
  end if;
  if coalesce(upper(btrim(p_code)), '') !~ '^[A-Z0-9][A-Z0-9_-]{1,29}$' then
    raise exception 'Invalid site code' using errcode = '22023';
  end if;
  insert into public.sites (id, code, name) values (site_id, upper(btrim(p_code)), btrim(p_name));
  insert into public.site_assignments (user_id, site_id, role_at_site)
    values ((select private.geo_actor()), site_id, 'admin');
  perform private.geo_audit(site_id, 'site.created', site_id);
  select * into strict saved from private.geo_list_sites(site_id);
  return saved;
end;
$$;

create function private.geo_update_site(p_site_id uuid, p_expected_revision bigint, p_name text, p_is_active boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  old_active boolean;
  current_revision bigint;
  saved jsonb;
begin
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

create function private.geo_save_site(p_site_id uuid, p_expected_revision bigint, p_details text,
  p_center jsonb, p_boundary jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  center_shape geo_extensions.geometry;
  boundary_shape geo_extensions.geometry;
  saved jsonb;
begin
  perform private.geo_require_active_site(p_site_id);
  center_shape := private.geo_geometry(p_center, 'Point');
  boundary_shape := private.geo_geometry(p_boundary, 'Polygon');
  if p_expected_revision = 0 then
    insert into public.site_geography (site_id, details, center, boundary)
      values (p_site_id, nullif(btrim(p_details), ''), center_shape, boundary_shape)
      on conflict (site_id) do nothing;
  else
    update public.site_geography
      set details = nullif(btrim(p_details), ''), center = center_shape, boundary = boundary_shape,
          revision = revision + 1, updated_at = clock_timestamp()
      where site_id = p_site_id and revision = p_expected_revision;
  end if;
  if not found then raise exception 'Geography revision conflict' using errcode = 'PT409'; end if;
  perform private.geo_audit(p_site_id, 'site.geography_saved', p_site_id);
  select * into strict saved from private.geo_list_sites(p_site_id);
  return saved;
end;
$$;

create function private.geo_create_post(p_site_id uuid, p_code text, p_name text, p_location jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  post_id uuid;
  saved jsonb;
begin
  perform private.geo_require_active_site(p_site_id);
  insert into public.security_posts (site_id, code, name, location)
    values (p_site_id, upper(btrim(p_code)), btrim(p_name), private.geo_geometry(p_location, 'Point'))
    returning id into post_id;
  perform private.geo_audit(p_site_id, 'security_post.created', post_id);
  select * into strict saved from private.geo_list_posts(p_site_id, post_id);
  return saved;
end;
$$;

create function private.geo_update_post(p_site_id uuid, p_post_id uuid, p_expected_revision bigint,
  p_code text, p_name text, p_is_active boolean, p_location jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  previous public.security_posts%rowtype;
  saved jsonb;
begin
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

-- Explicitly strip stock grants, including the Supabase default service grant.

revoke all on function private.geo_validate_position(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.geo_validate_position(jsonb) to smartops_geo_manager;

revoke all on function private.geo_orientation(numeric,numeric,numeric,numeric,numeric,numeric) from public, anon, authenticated, service_role;
grant execute on function private.geo_orientation(numeric,numeric,numeric,numeric,numeric,numeric) to smartops_geo_manager;

revoke all on function private.geo_validate_ring(jsonb) from public, anon, authenticated, service_role;
grant execute on function private.geo_validate_ring(jsonb) to smartops_geo_manager;

revoke all on function private.geo_geometry(jsonb,text) from public, anon, authenticated, service_role;
grant execute on function private.geo_geometry(jsonb,text) to smartops_geo_manager;

revoke all on function private.geo_is_admin() from public, anon, authenticated, service_role;
grant execute on function private.geo_is_admin() to smartops_geo_manager;

revoke all on function private.geo_managed_sites(boolean) from public, anon, authenticated, service_role;
grant execute on function private.geo_managed_sites(boolean) to smartops_geo_manager;

revoke all on function private.geo_require_active_site(uuid) from public, anon, authenticated, service_role;
grant execute on function private.geo_require_active_site(uuid) to smartops_geo_manager;

revoke all on function private.geo_audit(uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function private.geo_audit(uuid,text,uuid) to smartops_geo_manager;

revoke all on function private.geo_post_site_immutable() from public, anon, authenticated, service_role;

revoke all on function private.geo_lock_operational_site() from public, anon, authenticated, service_role;

revoke all on function private.geo_check_site_deactivation() from public, anon, authenticated, service_role;

grant create on schema private to smartops_geo_manager;

alter function private.geo_list_sites(uuid) owner to smartops_geo_manager;
revoke all on function private.geo_list_sites(uuid) from public, anon, authenticated, service_role;
grant execute on function private.geo_list_sites(uuid) to authenticated;

alter function private.geo_list_posts(uuid,uuid) owner to smartops_geo_manager;
revoke all on function private.geo_list_posts(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.geo_list_posts(uuid,uuid) to authenticated;

alter function private.geo_create_site(text,text) owner to smartops_geo_manager;
revoke all on function private.geo_create_site(text,text) from public, anon, authenticated, service_role;
grant execute on function private.geo_create_site(text,text) to authenticated;

alter function private.geo_update_site(uuid,bigint,text,boolean) owner to smartops_geo_manager;
revoke all on function private.geo_update_site(uuid,bigint,text,boolean) from public, anon, authenticated, service_role;
grant execute on function private.geo_update_site(uuid,bigint,text,boolean) to authenticated;

alter function private.geo_save_site(uuid,bigint,text,jsonb,jsonb) owner to smartops_geo_manager;
revoke all on function private.geo_save_site(uuid,bigint,text,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.geo_save_site(uuid,bigint,text,jsonb,jsonb) to authenticated;

alter function private.geo_create_post(uuid,text,text,jsonb) owner to smartops_geo_manager;
revoke all on function private.geo_create_post(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.geo_create_post(uuid,text,text,jsonb) to authenticated;

alter function private.geo_update_post(uuid,uuid,bigint,text,text,boolean,jsonb) owner to smartops_geo_manager;
revoke all on function private.geo_update_post(uuid,uuid,bigint,text,text,boolean,jsonb) from public, anon, authenticated, service_role;
grant execute on function private.geo_update_post(uuid,uuid,bigint,text,text,boolean,jsonb) to authenticated;

revoke create on schema private from smartops_geo_manager;

-- Public entry points are invokers. The tightly scoped internal executors

-- live in the non-exposed private schema and are subject to table RLS.

create function public.list_managed_sites(p_site_id uuid default null)
returns setof jsonb language sql stable security invoker set search_path = '' as $$
  select * from private.geo_list_sites(p_site_id)
$$;
revoke all on function public.list_managed_sites(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_managed_sites(uuid) to authenticated;

create function public.list_site_security_posts(p_site_id uuid)
returns setof jsonb language sql stable security invoker set search_path = '' as $$
  select * from private.geo_list_posts(p_site_id, null)
$$;
revoke all on function public.list_site_security_posts(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_site_security_posts(uuid) to authenticated;

create function public.create_managed_site(p_code text, p_name text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.geo_create_site(p_code,p_name)
$$;
revoke all on function public.create_managed_site(text,text) from public, anon, authenticated, service_role;
grant execute on function public.create_managed_site(text,text) to authenticated;

create function public.update_managed_site(p_site_id uuid, p_expected_revision bigint, p_name text, p_is_active boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.geo_update_site(p_site_id,p_expected_revision,p_name,p_is_active)
$$;
revoke all on function public.update_managed_site(uuid,bigint,text,boolean) from public, anon, authenticated, service_role;
grant execute on function public.update_managed_site(uuid,bigint,text,boolean) to authenticated;

create function public.save_site_geography(p_site_id uuid, p_expected_revision bigint, p_details text, p_center jsonb, p_boundary jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.geo_save_site(p_site_id,p_expected_revision,p_details,p_center,p_boundary)
$$;
revoke all on function public.save_site_geography(uuid,bigint,text,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_site_geography(uuid,bigint,text,jsonb,jsonb) to authenticated;

create function public.create_security_post(p_site_id uuid, p_code text, p_name text, p_location jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.geo_create_post(p_site_id,p_code,p_name,p_location)
$$;
revoke all on function public.create_security_post(uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_security_post(uuid,text,text,jsonb) to authenticated;

create function public.update_security_post(p_site_id uuid, p_post_id uuid, p_expected_revision bigint,
  p_code text, p_name text, p_is_active boolean, p_location jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.geo_update_post(p_site_id,p_post_id,p_expected_revision,p_code,p_name,p_is_active,p_location)
$$;
revoke all on function public.update_security_post(uuid,uuid,bigint,text,text,boolean,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_security_post(uuid,uuid,bigint,text,text,boolean,jsonb) to authenticated;

revoke smartops_geo_manager, smartops_geo_interlock from current_user;
