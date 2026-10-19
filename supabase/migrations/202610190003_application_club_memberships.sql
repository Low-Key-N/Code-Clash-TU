begin;

create table public.application_club_memberships (
  application_id uuid not null references public.applications(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  source text not null default 'organizer' check (source in ('registration', 'legacy', 'organizer')),
  assigned_by text,
  created_at timestamptz not null default now(),
  primary key (application_id, club_id)
);

alter table public.application_club_memberships enable row level security;
revoke all on public.application_club_memberships from public, anon, authenticated;
grant select, insert, update, delete on public.application_club_memberships to service_role;

-- Preserve current canonical assignments.
insert into public.application_club_memberships (application_id, club_id, source)
select id, student_organization_id, 'organizer'
from public.applications
where student_organization_id is not null
on conflict do nothing;

-- Recover every recognizable organization from legacy comma-separated answers.
with legacy_tokens as (
  select
    application.id as application_id,
    lower(regexp_replace(btrim(token.value), '[^a-z0-9]+', '', 'g')) as normalized
  from public.applications application
  cross join lateral regexp_split_to_table(application.student_organization_original, '[,;/&]+') token(value)
), legacy_slugs as (
  select
    application_id,
    case normalized
      when 'bitbrothers' then 'bit-brothers'
      when 'bitbrother' then 'bit-brothers'
      when 'bb' then 'bit-brothers'
      when 'sisterscripters' then 'sister-scripters'
      when 'sisterscripter' then 'sister-scripters'
      when 'itech' then 'itech'
      when 'informationtechnologyclub' then 'itech'
      when 'softwareengineeringclub' then 'software-engineering-club'
      when 'sec' then 'software-engineering-club'
      when 'robotics' then 'robotics-club'
      when 'roboticsclub' then 'robotics-club'
      when 'gamedesign' then 'game-design-club'
      when 'gamedesignclub' then 'game-design-club'
      when 'cyberdefense' then 'cyber-defense-club'
      when 'cyberdefenseclub' then 'cyber-defense-club'
      when 'nsbe' then 'nsbe'
      when 'nationalsocietyofblackengineers' then 'nsbe'
      when 'aiclub' then 'ai-club'
      when 'artificialintelligenceclub' then 'ai-club'
      when 'nsdc' then 'nsdc'
      when 'nationalsocietyofdiversecomputing' then 'nsdc'
      else null
    end as club_slug
  from legacy_tokens
)
insert into public.application_club_memberships (application_id, club_id, source)
select legacy.application_id, club.id, 'legacy'
from legacy_slugs legacy
join public.clubs club on club.slug = legacy.club_slug and club.active
where legacy.club_slug is not null
on conflict do nothing;

create or replace function public.set_application_clubs(
  applicant_id uuid,
  club_ids uuid[],
  reviewer text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_count integer := cardinality(coalesce(club_ids, '{}'::uuid[]));
  valid_count integer;
  primary_club clubs%rowtype;
  club_names text;
begin
  if nullif(btrim(reviewer), '') is null then raise exception 'Reviewer is required.'; end if;
  if not exists (select 1 from applications where id = applicant_id for update) then raise exception 'Application not found.'; end if;

  select count(distinct id) into valid_count from clubs where id = any(coalesce(club_ids, '{}'::uuid[])) and active;
  if valid_count <> requested_count then raise exception 'One or more selected clubs are invalid or inactive.'; end if;

  delete from application_club_memberships where application_id = applicant_id;
  insert into application_club_memberships (application_id, club_id, source, assigned_by)
  select applicant_id, selected_id, 'organizer', left(btrim(reviewer), 120)
  from unnest(coalesce(club_ids, '{}'::uuid[])) selected_id
  on conflict do nothing;

  select club.* into primary_club
  from clubs club
  where club.id = any(coalesce(club_ids, '{}'::uuid[]))
  order by club.display_order, club.name
  limit 1;
  select string_agg(club.name, ', ' order by club.display_order, club.name) into club_names
  from clubs club where club.id = any(coalesce(club_ids, '{}'::uuid[]));

  update applications set
    student_organization_id = primary_club.id,
    student_organization = coalesce(left(club_names, 150), 'None'),
    updated_at = now()
  where id = applicant_id;
end;
$$;

revoke all on function public.set_application_clubs(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.set_application_clubs(uuid, uuid[], text) to service_role;

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
    count(distinct membership.application_id) as registered,
    count(distinct membership.application_id) filter (where application.qualifying_submission) as submissions,
    club.display_order
  from clubs club
  left join application_club_memberships membership on membership.club_id = club.id
  left join applications application on application.id = membership.application_id
  where club.active
  group by club.id, club.slug, club.name, club.display_order
  order by club.display_order, club.name;
$$;

revoke all on function public.get_club_standings() from public, anon, authenticated;
grant execute on function public.get_club_standings() to service_role;

-- The event has not reached final submissions; clear test flags.
update public.applications set qualifying_submission = false where qualifying_submission;

commit;
