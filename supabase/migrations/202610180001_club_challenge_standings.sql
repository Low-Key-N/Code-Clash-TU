begin;

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique check (char_length(name) between 2 and 100),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.clubs (id, slug, name, display_order) values
  ('cc260001-0000-4000-8000-000000000001', 'bit-brothers', 'Bit Brothers', 10),
  ('cc260001-0000-4000-8000-000000000002', 'sister-scripters', 'Sister Scripters', 20),
  ('cc260001-0000-4000-8000-000000000003', 'itech', 'iTech', 30),
  ('cc260001-0000-4000-8000-000000000004', 'software-engineering-club', 'Software Engineering Club (SEC)', 40),
  ('cc260001-0000-4000-8000-000000000005', 'robotics-club', 'Robotics Club', 50),
  ('cc260001-0000-4000-8000-000000000006', 'game-design-club', 'Game Design Club', 60),
  ('cc260001-0000-4000-8000-000000000007', 'cyber-defense-club', 'Cyber Defense Club', 70),
  ('cc260001-0000-4000-8000-000000000008', 'nsbe', 'National Society of Black Engineers (NSBE)', 80),
  ('cc260001-0000-4000-8000-000000000009', 'ai-club', 'AI Club', 90),
  ('cc260001-0000-4000-8000-000000000010', 'nsdc', 'National Society of Diverse Computing (NSDC)', 100);

alter table public.clubs enable row level security;
revoke all on public.clubs from public, anon, authenticated;
grant select on public.clubs to service_role;

alter table public.applications
  add column student_organization_id uuid references public.clubs(id) on delete set null,
  add column student_organization_original text not null default 'None',
  add column qualifying_submission boolean not null default false;

-- Preserve every legacy free-text response before assigning canonical clubs.
update public.applications
set student_organization_original = student_organization;

update public.applications application
set student_organization_id = club.id,
    student_organization = club.name
from public.clubs club
where lower(btrim(application.student_organization)) = lower(club.name);

create index applications_student_organization_idx
  on public.applications (student_organization_id)
  where student_organization_id is not null;
create index applications_qualifying_submission_idx
  on public.applications (student_organization_id)
  where qualifying_submission;

create or replace function public.get_club_standings()
returns table (slug text, name text, registered bigint, submissions bigint, display_order integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    club.slug,
    club.name,
    count(application.id) as registered,
    count(application.id) filter (where application.qualifying_submission) as submissions,
    club.display_order
  from clubs club
  left join applications application on application.student_organization_id = club.id
  where club.active
  group by club.id, club.slug, club.name, club.display_order
  order by club.display_order, club.name;
$$;

revoke all on function public.get_club_standings() from public, anon, authenticated;
grant execute on function public.get_club_standings() to service_role;
grant select, update on public.clubs to service_role;
grant select, update on public.applications to service_role;

commit;
