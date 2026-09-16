-- Run against a migrated local/test database. All fixtures roll back.
begin;

create function pg_temp.expect_assignment_error(applicant uuid, team uuid, role_name text, expected text)
returns void language plpgsql as $$
begin
  perform public.assign_solo_to_team(applicant, team, role_name, 'Test organizer');
  raise exception 'Expected assignment to fail: %', expected;
exception when sqlstate 'P0001' then
  if sqlerrm <> expected then raise; end if;
end;
$$;

do $$
declare
  private_app uuid := gen_random_uuid();
  public_app uuid := gen_random_uuid();
  waiting_app uuid := gen_random_uuid();
  joining_app uuid := gen_random_uuid();
  team uuid := gen_random_uuid();
  archived_team uuid := gen_random_uuid();
  membership uuid;
begin
  insert into public.applications (
    id, full_name, school_email, school, major, graduation_year, experience_level,
    desired_roles, project_interests, team_status, application_status,
    public_board_consent, agreed_to_rules_at, confirmed_accurate_at, team_lookup
  ) values
    (private_app, 'Private Person', private_app || '@example.edu', 'Test School', 'CS', 2027, 'Beginner', array['Builder'], 'Test project interests', 'solo', 'approved', false, now(), now(), null),
    (public_app, 'Public Person', public_app || '@example.edu', 'Test School', 'CS', 2027, 'Beginner', array['Designer'], 'Test project interests', 'solo', 'approved', true, now(), now(), null),
    (waiting_app, 'Waiting Person', waiting_app || '@example.edu', 'Test School', 'CS', 2027, 'Beginner', array['Builder'], 'Test project interests', 'solo', 'submitted', false, now(), now(), null),
    (joining_app, 'Joining Person', joining_app || '@example.edu', 'Test School', 'CS', 2027, 'Beginner', array['Builder'], 'Test project interests', 'joining', 'approved', false, now(), now(), 'Test team');
  insert into public.public_teams (id, team_name, capacity, occupied_slots, roles_needed, publication_status)
    values (team, 'Assignment test', 2, 0, array['Builder', 'Designer'], 'draft'),
           (archived_team, 'Archived test', 2, 0, '{}', 'archived');

  perform pg_temp.expect_assignment_error(waiting_app, team, 'Builder', 'Approve the application before assigning a team.');
  perform pg_temp.expect_assignment_error(joining_app, team, 'Builder', 'Only solo applicants can be assigned here.');
  perform pg_temp.expect_assignment_error(private_app, archived_team, 'Builder', 'Choose an active team.');
  perform pg_temp.expect_assignment_error(private_app, gen_random_uuid(), 'Builder', 'Choose an active team.');
  perform pg_temp.expect_assignment_error(gen_random_uuid(), team, 'Builder', 'Only solo applicants can be assigned here.');
  perform pg_temp.expect_assignment_error(private_app, team, 'Unknown', 'Choose a valid team role.');
  perform pg_temp.expect_assignment_error(private_app, team, null, 'Choose a valid team role.');

  membership := public.assign_solo_to_team(private_app, team, 'Builder', 'Test organizer');
  if not exists (select 1 from public.team_join_requests where id = membership
      and application_id = private_app and public_team_id = team and status = 'approved'
      and source = 'organizer' and owner_approved_at is null
      and organizer_reviewed_by = 'Test organizer' and organizer_reviewed_at is not null) then
    raise exception 'Missing assignment audit record';
  end if;
  if not exists (select 1 from public.public_teams where id = team and occupied_slots = 1
      and cardinality(member_first_names) = 0 and cardinality(member_roles) = 0
      and roles_needed = array['Designer']) then
    raise exception 'Private assignment did not update occupancy or preserve consent';
  end if;
  if not exists (select 1 from public.applications where id = private_app and team_status = 'solo') then
    raise exception 'Original application was changed';
  end if;
  perform pg_temp.expect_assignment_error(private_app, team, 'Builder', 'This applicant already has a team membership or join request.');
  perform pg_temp.expect_assignment_error(private_app, archived_team, 'Builder', 'Choose an active team.');

  insert into public.team_join_requests (application_id, public_team_id, desired_role, owner_approved_at)
    values (joining_app, team, 'Builder', now());
  perform pg_temp.expect_assignment_error(public_app, team, 'Designer', 'This team has no available slots, including pending reservations.');
  if exists (select 1 from public.team_join_requests where application_id = public_app) then
    raise exception 'Failed assignment left a membership record';
  end if;
  update public.team_join_requests set expires_at = now() - interval '1 minute' where application_id = joining_app;
  -- Expired reservations do not block assignment to a published team.
  update public.public_teams set publication_status = 'published', reviewed_by = 'Test organizer', published_at = now() where id = team;
  perform public.assign_solo_to_team(public_app, team, 'Designer', 'Test organizer');
  if not exists (select 1 from public.public_teams where id = team and occupied_slots = 2
      and member_first_names = array['Public'] and member_roles = array['Designer']
      and cardinality(roles_needed) = 0) then
    raise exception 'Public assignment did not update team correctly';
  end if;
  update public.applications set application_status = 'approved' where id = waiting_app;
  perform pg_temp.expect_assignment_error(waiting_app, team, 'Builder', 'This team has no available slots, including pending reservations.');
  if (select occupied_slots from public.public_teams where id = team) <> 2 then
    raise exception 'Failed or duplicate assignment changed capacity';
  end if;

  if has_function_privilege('anon', 'public.assign_solo_to_team(uuid,uuid,text,text)', 'execute')
      or has_function_privilege('authenticated', 'public.assign_solo_to_team(uuid,uuid,text,text)', 'execute')
      or not has_function_privilege('service_role', 'public.assign_solo_to_team(uuid,uuid,text,text)', 'execute') then
    raise exception 'Incorrect assignment function permissions';
  end if;
end;
$$;

rollback;
