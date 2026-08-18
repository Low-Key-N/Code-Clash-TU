begin;
create extension if not exists citext;

-- Abort before replacing the legacy table if production contains data or unknown dependencies.
do $$
declare
  application_count bigint;
  participant_links bigint := 0;
  unexpected_dependencies text;
  obsolete_policy record;
  participant_fk record;
begin
  if to_regclass('public.applications') is not null then
    execute 'select count(*) from public.applications' into application_count;
    if application_count <> 0 then
      raise exception 'Refusing to replace public.applications: found % existing row(s)', application_count;
    end if;
    if to_regclass('public.participants') is not null and exists (
      select 1 from information_schema.columns where table_schema = 'public' and table_name = 'participants' and column_name = 'application_id'
    ) then
      execute 'select count(*) from public.participants where application_id is not null' into participant_links;
      if participant_links <> 0 then
        raise exception 'Refusing to replace public.applications: participants has % linked row(s)', participant_links;
      end if;
    end if;
    select string_agg(format('%I.%I (%I)', n.nspname, c.relname, con.conname), ', ')
      into unexpected_dependencies
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where con.contype = 'f' and con.confrelid = 'public.applications'::regclass
      and not (n.nspname = 'public' and c.relname = 'participants');
    if unexpected_dependencies is not null then
      raise exception 'Refusing to replace public.applications: unexpected foreign keys: %', unexpected_dependencies;
    end if;
    for obsolete_policy in select policyname from pg_policies where schemaname = 'public' and tablename = 'applications' loop
      execute format('drop policy if exists %I on public.applications', obsolete_policy.policyname);
    end loop;
    if to_regclass('public.participants') is not null then
      for participant_fk in
        select conname from pg_constraint
        where contype = 'f' and conrelid = 'public.participants'::regclass and confrelid = 'public.applications'::regclass
      loop
        execute format('alter table public.participants drop constraint %I', participant_fk.conname);
      end loop;
    end if;
    -- A plain DROP intentionally aborts if any unreviewed view/function dependency exists.
    drop table public.applications;
  end if;
end;
$$;

create table public.applications (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  full_name text not null check (char_length(full_name) between 2 and 100),
  school_email citext not null unique check (char_length(school_email::text) <= 254),
  school text not null check (char_length(school) between 2 and 150), major text not null check (char_length(major) between 1 and 120),
  graduation_year smallint not null check (graduation_year between 2026 and 2035),
  experience_level text not null check (experience_level in ('Beginner', 'Intermediate', 'Advanced')),
  desired_roles text[] not null check (cardinality(desired_roles) between 1 and 5 and desired_roles <@ array['Builder', 'Defender', 'Analyst', 'Designer', 'Strategist']),
  project_interests text not null check (char_length(project_interests) between 10 and 1000),
  team_status text not null check (team_status in ('solo', 'creating', 'joining')),
  student_organization text not null default 'None' check (char_length(student_organization) <= 150),
  proposed_team_name text check (proposed_team_name is null or char_length(proposed_team_name) between 1 and 80),
  roles_needed text[] not null default '{}' check (roles_needed <@ array['Builder', 'Defender', 'Analyst', 'Designer', 'Strategist']),
  team_lookup text check (team_lookup is null or char_length(team_lookup) between 1 and 80),
  phone text check (phone is null or char_length(phone) <= 30), pronouns text check (pronouns is null or char_length(pronouns) <= 50),
  dietary_restrictions text check (dietary_restrictions is null or char_length(dietary_restrictions) <= 500),
  accessibility_accommodations text check (accessibility_accommodations is null or char_length(accessibility_accommodations) <= 1000),
  portfolio_url text check (portfolio_url is null or char_length(portfolio_url) <= 500),
  public_board_consent boolean not null default false, marketing_consent boolean not null default false,
  agreed_to_rules_at timestamptz not null, confirmed_accurate_at timestamptz not null,
  constraint valid_team_fields check (
    (team_status = 'solo' and proposed_team_name is null and cardinality(roles_needed) = 0 and team_lookup is null) or
    (team_status = 'creating' and proposed_team_name is not null and cardinality(roles_needed) > 0 and team_lookup is null) or
    (team_status = 'joining' and proposed_team_name is null and cardinality(roles_needed) = 0 and team_lookup is not null)
  )
);
alter table public.applications enable row level security;
revoke all on public.applications from anon, authenticated;

-- CASCADE removes the old participants FK, but not its column or rows.
do $$
begin
  if to_regclass('public.participants') is not null then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'participants' and column_name = 'application_id') then
      alter table public.participants add column application_id uuid;
    else
      alter table public.participants alter column application_id drop default;
      alter table public.participants alter column application_id drop not null;
      alter table public.participants alter column application_id type uuid using application_id::text::uuid;
    end if;
    alter table public.participants drop constraint if exists participants_application_id_fkey;
    alter table public.participants add constraint participants_application_id_fkey foreign key (application_id) references public.applications(id) on delete set null;
  end if;
end;
$$;

drop table if exists public.application_rate_limits;
create table public.application_rate_limits (source_hash text primary key, window_started_at timestamptz not null default now(), attempts smallint not null default 1 check (attempts > 0));
alter table public.application_rate_limits enable row level security;
revoke all on public.application_rate_limits from anon, authenticated;
create or replace function public.consume_application_rate_limit(request_source_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare allowed boolean;
begin
  insert into application_rate_limits (source_hash, window_started_at, attempts) values (request_source_hash, now(), 1)
  on conflict (source_hash) do update set
    window_started_at = case when application_rate_limits.window_started_at < now() - interval '1 hour' then now() else application_rate_limits.window_started_at end,
    attempts = case when application_rate_limits.window_started_at < now() - interval '1 hour' then 1 else least(application_rate_limits.attempts + 1, 32767) end
  returning attempts <= 30 into allowed;
  return allowed;
end;
$$;
revoke all on function public.consume_application_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_application_rate_limit(text) to service_role;

-- Organizer-curated projection containing only approved public fields.
create table public.public_teams (
  id uuid primary key default gen_random_uuid(), team_name text not null check (char_length(team_name) between 1 and 80),
  member_first_names text[] not null default '{}', member_roles text[] not null default '{}', roles_needed text[] not null default '{}',
  approved_project_interests text not null default '' check (char_length(approved_project_interests) <= 300),
  capacity smallint not null default 4 check (capacity between 2 and 8),
  publication_status text not null default 'draft' check (publication_status in ('draft', 'published', 'archived')),
  reviewed_by text check (reviewed_by is null or char_length(reviewed_by) <= 120), published_at timestamptz,
  display_order integer not null default 0, updated_at timestamptz not null default now(),
  constraint public_team_member_shapes check (cardinality(member_first_names) = cardinality(member_roles)),
  constraint public_team_capacity check (cardinality(member_roles) <= capacity),
  constraint public_team_member_names check (array_position(member_first_names, '') is null),
  constraint public_team_roles check (member_roles <@ array['Builder', 'Defender', 'Analyst', 'Designer', 'Strategist'] and roles_needed <@ array['Builder', 'Defender', 'Analyst', 'Designer', 'Strategist']),
  constraint published_team_review check (publication_status <> 'published' or (reviewed_by is not null and published_at is not null))
);
alter table public.public_teams enable row level security;
revoke all on public.public_teams from anon, authenticated;

create or replace function public.publish_public_team(team_id uuid, reviewer text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(reviewer), '') is null then raise exception 'Reviewer is required'; end if;
  update public_teams set publication_status = 'published', reviewed_by = left(btrim(reviewer), 120), published_at = now(), updated_at = now() where id = team_id;
  if not found then raise exception 'Public team not found'; end if;
end;
$$;
revoke all on function public.publish_public_team(uuid, text) from public, anon, authenticated;
grant execute on function public.publish_public_team(uuid, text) to service_role;

create or replace function public.archive_public_team(team_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public_teams set publication_status = 'archived', updated_at = now() where id = team_id;
  if not found then raise exception 'Public team not found'; end if;
end;
$$;
revoke all on function public.archive_public_team(uuid) from public, anon, authenticated;
grant execute on function public.archive_public_team(uuid) to service_role;

commit;
