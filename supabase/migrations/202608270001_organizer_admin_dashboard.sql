begin;

-- Extend the existing application table with organizer-managed review state.
alter table public.applications
  add column if not exists application_status text not null default 'submitted',
  add column if not exists organizer_notes text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.applications
  drop constraint if exists applications_application_status_check;
alter table public.applications
  add constraint applications_application_status_check
  check (application_status in ('submitted', 'approved', 'waitlisted', 'rejected'));

alter table public.applications
  drop constraint if exists applications_organizer_notes_check;
alter table public.applications
  add constraint applications_organizer_notes_check
  check (organizer_notes is null or char_length(organizer_notes) <= 2000);

create index if not exists applications_status_created_at_idx
  on public.applications (application_status, created_at desc);
create index if not exists applications_created_at_idx
  on public.applications (created_at desc);
create index if not exists public_teams_status_updated_at_idx
  on public.public_teams (publication_status, updated_at desc);

-- Private tables remain inaccessible from browser roles. The admin Edge
-- Function uses service_role only after independently authenticating the JWT
-- and confirming membership in public.organizers.
revoke all on public.applications from anon, authenticated;
revoke all on public.public_teams from anon, authenticated;
revoke all on public.team_invites from anon, authenticated;
revoke all on public.team_join_requests from anon, authenticated;

grant select, update, delete on public.applications to service_role;
grant select, insert, update, delete on public.public_teams to service_role;
grant select, insert, update, delete on public.team_invites to service_role;
grant select, update, delete on public.team_join_requests to service_role;
grant execute on function public.publish_public_team(uuid, text) to service_role;
grant execute on function public.archive_public_team(uuid) to service_role;

commit;
