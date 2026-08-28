begin;

-- organizer-admin needs only these profile columns to authorize an already
-- authenticated user. Browser roles retain no direct organizer-table access.
revoke all on public.organizers from anon, authenticated;
grant select (user_id, display_name) on public.organizers to service_role;

commit;
