-- Pixelboard production store (Vercel deploy). Mirrors the filesystem layout of
-- src/storage_fs.js: one row per "file", keyed by its relative path
-- (e.g. sites/<id>/content.json). Binary assets live in the private storage
-- bucket `pixelboard-assets`, not here.
--
-- Same pattern as postbench: own schema, NOT in PostgREST db_schema, no
-- anon/authenticated access. All access goes through SECURITY DEFINER functions
-- in public, prefixed pixelboard_, executable by service_role only.

create schema if not exists pixelboard;
revoke all on schema pixelboard from public, anon, authenticated;

create table if not exists pixelboard.objects (
  path       text primary key,
  body       text not null,
  updated_at timestamptz not null default now()
);
alter table pixelboard.objects enable row level security;
revoke all on pixelboard.objects from public, anon, authenticated;

create or replace function public.pixelboard_get(p_path text)
returns text language sql stable security definer set search_path = '' as $$
  select body from pixelboard.objects where path = p_path;
$$;

-- Atomic multi-write: items = [{"path": "...", "body": "..."}, ...]
create or replace function public.pixelboard_put_many(items jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into pixelboard.objects (path, body, updated_at)
  select i->>'path', i->>'body', now() from jsonb_array_elements(items) i
  on conflict (path) do update set body = excluded.body, updated_at = excluded.updated_at;
$$;

-- LIKE-pattern listing; ids are hex so % / _ never appear literally.
create or replace function public.pixelboard_list(pattern text, with_body boolean default true)
returns table (path text, body text) language sql stable security definer set search_path = '' as $$
  select o.path, case when with_body then o.body end from pixelboard.objects o where o.path like pattern;
$$;

create or replace function public.pixelboard_delete(p_path text)
returns void language sql security definer set search_path = '' as $$
  delete from pixelboard.objects where path = p_path;
$$;

revoke all on function public.pixelboard_get(text) from public, anon, authenticated;
revoke all on function public.pixelboard_put_many(jsonb) from public, anon, authenticated;
revoke all on function public.pixelboard_list(text, boolean) from public, anon, authenticated;
revoke all on function public.pixelboard_delete(text) from public, anon, authenticated;
grant execute on function public.pixelboard_get(text) to service_role;
grant execute on function public.pixelboard_put_many(jsonb) to service_role;
grant execute on function public.pixelboard_list(text, boolean) to service_role;
grant execute on function public.pixelboard_delete(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('pixelboard-assets', 'pixelboard-assets', false, 20971520)
on conflict (id) do nothing;
