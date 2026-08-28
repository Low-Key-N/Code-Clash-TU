begin;

alter table public.applications
  add column if not exists organizer_team_invite_code text;

alter table public.applications
  drop constraint if exists applications_organizer_team_invite_code_check;
alter table public.applications
  add constraint applications_organizer_team_invite_code_check
  check (
    organizer_team_invite_code is null or
    char_length(organizer_team_invite_code) between 12 and 80
  );

-- The code is a private team credential. Browser roles retain no access.
revoke all on public.applications from anon, authenticated;
grant select, update on public.applications to service_role;

commit;
