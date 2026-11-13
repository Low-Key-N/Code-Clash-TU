begin;

alter table public.public_teams
  add column if not exists club_challenge_status text not null default 'pending',
  add column if not exists club_challenge_disqualification_reason text,
  add column if not exists club_challenge_reviewed_by text,
  add column if not exists club_challenge_reviewed_at timestamptz;

alter table public.public_teams
  drop constraint if exists public_teams_club_challenge_status_check;
alter table public.public_teams
  add constraint public_teams_club_challenge_status_check
  check (club_challenge_status in ('pending', 'qualified', 'disqualified'));

alter table public.public_teams
  drop constraint if exists public_teams_club_challenge_reason_check;
alter table public.public_teams
  add constraint public_teams_club_challenge_reason_check
  check (
    (club_challenge_status = 'disqualified'
      and nullif(btrim(club_challenge_disqualification_reason), '') is not null
      and char_length(club_challenge_disqualification_reason) <= 500)
    or
    (club_challenge_status <> 'disqualified'
      and club_challenge_disqualification_reason is null)
  );

create index if not exists public_teams_club_challenge_status_idx
  on public.public_teams (club_challenge_status, updated_at desc);

-- Preserve any organizer decisions made with the former per-person checkbox by
-- promoting the participant's current team to qualified before retiring that flag.
with previously_qualified_teams as (
  select invite.public_team_id as team_id
  from public.team_invites invite
  join public.applications application on application.id = invite.owner_application_id
  where invite.revoked_at is null and application.qualifying_submission
  union
  select membership.public_team_id
  from public.team_join_requests membership
  join public.applications application on application.id = membership.application_id
  where membership.status = 'approved' and application.qualifying_submission
)
update public.public_teams team
set club_challenge_status = 'qualified',
    club_challenge_reviewed_by = 'legacy application flag migration',
    club_challenge_reviewed_at = now()
where team.id in (select team_id from previously_qualified_teams);

-- Team qualification is now the source of truth; this legacy column remains only
-- for migration compatibility and is no longer read by the standings.
update public.applications set qualifying_submission = false where qualifying_submission;

create or replace function public.get_club_standings()
returns table (slug text, name text, registered bigint, submissions bigint, display_order integer)
language sql
security definer
set search_path = public
stable
as $$
  with qualified_team_members as (
    select invite.owner_application_id as application_id
    from team_invites invite
    join public_teams team on team.id = invite.public_team_id
    where invite.revoked_at is null
      and invite.owner_application_id is not null
      and team.club_challenge_status = 'qualified'
    union
    select membership.application_id
    from team_join_requests membership
    join public_teams team on team.id = membership.public_team_id
    where membership.status = 'approved'
      and team.club_challenge_status = 'qualified'
  )
  select
    club.slug,
    club.name,
    count(distinct membership.application_id) as registered,
    count(distinct membership.application_id)
      filter (where qualified.application_id is not null) as submissions,
    club.display_order
  from clubs club
  left join application_club_memberships membership on membership.club_id = club.id
  left join qualified_team_members qualified on qualified.application_id = membership.application_id
  where club.active
  group by club.id, club.slug, club.name, club.display_order
  order by club.display_order, club.name;
$$;

revoke all on function public.get_club_standings() from public, anon, authenticated;
grant execute on function public.get_club_standings() to service_role;

commit;
