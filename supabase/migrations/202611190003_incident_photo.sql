begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('incident-evidence','incident-evidence',false,6291456,array['image/jpeg'])
on conflict (id) do nothing;

create table public.incident_photos (
  id uuid primary key,
  incident_id uuid not null references public.incidents(id),
  author_id uuid not null references public.profiles(id),
  object_path text not null unique,
  created_at timestamptz not null default now(),
  unique(incident_id)
);
alter table public.incident_photos enable row level security;
grant select on public.incident_photos to authenticated;
create policy incident_photos_read on public.incident_photos for select to authenticated
using (exists(select 1 from public.incidents i where i.id=incident_id and
  (i.reporter_id=auth.uid() or private.has_site_access(i.site_id,array['supervisor','admin']::public.smartops_role[]))));

create function public.register_incident_photo(p_id uuid,p_incident_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare i public.incidents%rowtype; p public.incident_photos%rowtype; target text;
begin
 select * into i from public.incidents where id=p_incident_id for update;
 if not found or auth.uid() is distinct from i.reporter_id or
    not private.has_site_access(i.site_id,array['guard']::public.smartops_role[]) then
   raise exception 'Not authorized' using errcode='42501';
 end if;
 target := i.id::text || '/' || p_id::text || '.jpg';
 select * into p from public.incident_photos where incident_id=i.id;
 if found then
   if p.id<>p_id or p.author_id<>auth.uid() then raise exception 'Conflicting photo'; end if;
 else
   insert into public.incident_photos(id,incident_id,author_id,object_path)
     values(p_id,i.id,auth.uid(),target);
 end if;
 return target;
end $$;
revoke all on function public.register_incident_photo(uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_incident_photo(uuid,uuid) to authenticated;

create policy incident_photo_upload on storage.objects for insert to authenticated
with check (bucket_id='incident-evidence' and exists(
  select 1 from public.incident_photos p join public.incidents i on i.id=p.incident_id
  where p.object_path=name and p.author_id=auth.uid() and i.reporter_id=auth.uid()
  and private.has_site_access(i.site_id,array['guard']::public.smartops_role[])));
create policy incident_photo_update on storage.objects for update to authenticated
using (bucket_id='incident-evidence' and exists(
  select 1 from public.incident_photos p where p.object_path=name and p.author_id=auth.uid()))
with check (bucket_id='incident-evidence' and exists(
  select 1 from public.incident_photos p join public.incidents i on i.id=p.incident_id
  where p.object_path=name and p.author_id=auth.uid() and i.reporter_id=auth.uid()
  and private.has_site_access(i.site_id,array['guard']::public.smartops_role[])));
create policy incident_photo_read on storage.objects for select to authenticated
using (bucket_id='incident-evidence' and exists(
  select 1 from public.incident_photos p join public.incidents i on i.id=p.incident_id
  where p.object_path=name and (i.reporter_id=auth.uid() or
  private.has_site_access(i.site_id,array['supervisor','admin']::public.smartops_role[]))));
commit;
