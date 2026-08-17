create extension if not exists citext;

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null check (char_length(full_name) between 2 and 100),
  school_email citext not null unique check (char_length(school_email::text) <= 254),
  school text not null check (char_length(school) between 2 and 150),
  major text not null check (char_length(major) between 1 and 120),
  graduation_year smallint not null check (graduation_year between 2026 and 2035),
  experience_level text not null check (experience_level in ('Beginner', 'Intermediate', 'Advanced')),
  desired_roles text[] not null check (cardinality(desired_roles) between 1 and 5 and desired_roles <@ array['Builder', 'Defender', 'Analyst', 'Designer', 'Strategist']),
  project_interests text not null check (char_length(project_interests) between 10 and 1000),
  team_status text not null check (team_status in ('solo', 'creating', 'joining')),
  student_organization text not null default 'None' check (char_length(student_organization) <= 150),
  proposed_team_name text check (proposed_team_name is null or char_length(proposed_team_name) between 1 and 80),
  roles_needed text[] not null default '{}' check (roles_needed <@ array['Builder', 'Defender', 'Analyst', 'Designer', 'Strategist']),
  team_lookup text check (team_lookup is null or char_length(team_lookup) between 1 and 80),
  phone text check (phone is null or char_length(phone) <= 30),
  pronouns text check (pronouns is null or char_length(pronouns) <= 50),
  dietary_restrictions text check (dietary_restrictions is null or char_length(dietary_restrictions) <= 500),
  accessibility_accommodations text check (accessibility_accommodations is null or char_length(accessibility_accommodations) <= 1000),
  portfolio_url text check (portfolio_url is null or char_length(portfolio_url) <= 500),
  public_board_consent boolean not null default false,
  marketing_consent boolean not null default false,
  agreed_to_rules_at timestamptz not null,
  confirmed_accurate_at timestamptz not null,
  constraint valid_team_fields check (
    (team_status = 'solo' and proposed_team_name is null and cardinality(roles_needed) = 0 and team_lookup is null) or
    (team_status = 'creating' and proposed_team_name is not null and cardinality(roles_needed) > 0 and team_lookup is null) or
    (team_status = 'joining' and proposed_team_name is null and cardinality(roles_needed) = 0 and team_lookup is not null)
  )
);

alter table public.applications enable row level security;
revoke all on public.applications from anon, authenticated;

create table public.application_rate_limits (
  source_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempts smallint not null default 1 check (attempts > 0)
);

alter table public.application_rate_limits enable row level security;
revoke all on public.application_rate_limits from anon, authenticated;

create or replace function public.consume_application_rate_limit(request_source_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  insert into application_rate_limits (source_hash, window_started_at, attempts)
  values (request_source_hash, now(), 1)
  on conflict (source_hash) do update
    set window_started_at = case
          when application_rate_limits.window_started_at < now() - interval '1 hour' then now()
          else application_rate_limits.window_started_at
        end,
        attempts = case
          when application_rate_limits.window_started_at < now() - interval '1 hour' then 1
          else least(application_rate_limits.attempts + 1, 32767)
        end
  returning attempts <= 5 into allowed;
  return allowed;
end;
$$;

revoke all on function public.consume_application_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_application_rate_limit(text) to service_role;
