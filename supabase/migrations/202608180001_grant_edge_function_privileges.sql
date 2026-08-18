begin;

revoke all on public.applications from anon, authenticated;
revoke all on public.application_rate_limits from anon, authenticated;
revoke all on public.public_teams from anon, authenticated;

grant insert on public.applications to service_role;
grant select on public.public_teams to service_role;

commit;
