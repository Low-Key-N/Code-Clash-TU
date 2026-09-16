-- Run against a migrated local/test database. All fixtures roll back.
begin;
create function pg_temp.expect_move_error(applicant uuid, old_team uuid, new_team uuid, role_name text, expected text)
returns void language plpgsql as $$
begin
  perform public.move_team_member(applicant, old_team, new_team, role_name, 'Test organizer');
  raise exception 'Expected move to fail: %', expected;
exception when sqlstate 'P0001' then
  if sqlerrm <> expected then raise; end if;
end;
$$;

do $$
declare
  private_app uuid := gen_random_uuid();
  public_app uuid := gen_random_uuid();
  creator_app uuid := gen_random_uuid();
  pending_app uuid := gen_random_uuid();
  first_team uuid := gen_random_uuid();
  second_team uuid := gen_random_uuid();
  creator_team uuid := gen_random_uuid();
  archived_team uuid := gen_random_uuid();
begin
  insert into public.applications (
    id, full_name, school_email, school, major, graduation_year, experience_level,
    desired_roles, project_interests, team_status, application_status,
    public_board_consent, agreed_to_rules_at, confirmed_accurate_at,
    proposed_team_name, roles_needed, team_lookup, organizer_team_invite_code
  ) values
    (private_app, 'Private Person', private_app || '@example.edu', 'Test School', 'CS', 2027, 'Beginner', array['Builder'], 'Test project interests', 'solo', 'approved', false, now(), now(), null, '{}', null, null),
    (public_app, 'Alex Person', public_app || '@example.edu', 'Test School', 'CS', 2027, 'Beginner', array['Designer'], 'Test project interests', 'solo', 'approved', true, now(), now(), null, '{}', null, null),
    (creator_app, 'Creator Person', creator_app || '@example.edu', 'Test School', 'CS', 2027, 'Beginner', array['Builder'], 'Test project interests', 'creating', 'approved', true, now(), now(), 'Creator team', array['Designer'], null, 'CREATORTEST123456'),
    (pending_app, 'Pending Person', pending_app || '@example.edu', 'Test School', 'CS', 2027, 'Beginner', array['Builder'], 'Test project interests', 'joining', 'approved', false, now(), now(), null, '{}', 'Test team', null);
  insert into public.public_teams (id, team_name, capacity, occupied_slots, member_first_names, member_roles, publication_status)
    values (first_team, 'First test team', 4, 1, array['Alex'], array['Designer'], 'draft'),
      (second_team, 'Second test team', 2, 0, '{}', '{}', 'draft'),
      (creator_team, 'Creator test team', 4, 1, array['Creator'], array['Builder'], 'draft'),
      (archived_team, 'Archived team', 4, 0, '{}', '{}', 'archived');
  insert into public.team_invites (public_team_id, owner_application_id, invite_code_hash)
    values (creator_team, creator_app, creator_app::text);
  perform public.assign_solo_to_team(private_app, first_team, 'Builder', 'Test organizer');
  perform public.assign_solo_to_team(public_app, first_team, 'Designer', 'Test organizer');
  -- Also exercise an approved invite membership, not only organizer assignments.
  update public.team_join_requests set source = 'invite', owner_approved_at = now() where application_id = public_app;

  perform pg_temp.expect_move_error(private_app, first_team, first_team, 'Builder', 'Choose a different team or return the participant to solo.');
  perform pg_temp.expect_move_error(private_app, first_team, archived_team, 'Builder', 'Choose an active destination team.');
  perform pg_temp.expect_move_error(private_app, first_team, gen_random_uuid(), 'Builder', 'Choose an active destination team.');
  perform pg_temp.expect_move_error(private_app, first_team, second_team, 'Invalid', 'Choose a valid team role.');
  perform pg_temp.expect_move_error(private_app, second_team, null, null, 'Team membership changed. Reopen the application before moving this participant.');

  perform public.move_team_member(private_app, first_team, second_team, 'Analyst', 'Test organizer');
  if not exists (select 1 from public.public_teams where id = second_team and occupied_slots = 1 and cardinality(member_first_names) = 0) then
    raise exception 'Private transfer exposed public data or failed to update capacity';
  end if;
  if not exists (select 1 from public.public_teams where id = first_team and occupied_slots = 2 and member_first_names = array['Alex', 'Alex']) then
    raise exception 'Private transfer removed another member';
  end if;
  perform pg_temp.expect_move_error(private_app, first_team, null, null, 'Team membership changed. Reopen the application before moving this participant.');

  insert into public.team_join_requests (application_id, public_team_id, desired_role, owner_approved_at)
    values (pending_app, second_team, 'Builder', now());
  perform pg_temp.expect_move_error(public_app, first_team, second_team, 'Designer', 'This team has no available slots, including pending reservations.');
  if not exists (select 1 from public.team_join_requests where application_id = public_app and public_team_id = first_team and source = 'invite') then
    raise exception 'Failed transfer changed membership';
  end if;
  perform pg_temp.expect_move_error(pending_app, second_team, first_team, 'Builder', 'This applicant does not have an approved team membership.');
  update public.team_join_requests set expires_at = now() - interval '1 minute' where application_id = pending_app;
  perform public.move_team_member(public_app, first_team, second_team, 'Strategist', 'Test organizer');
  if not exists (select 1 from public.public_teams where id = first_team and occupied_slots = 1
      and member_first_names = array['Alex'] and member_roles = array['Designer'] and 'Designer' = any(roles_needed)) then
    raise exception 'Transfer failed to remove exactly one duplicate name/role pair';
  end if;
  if not exists (select 1 from public.public_teams where id = second_team and occupied_slots = 2
      and member_first_names = array['Alex'] and member_roles = array['Strategist']) then
    raise exception 'Transfer failed to add destination public member';
  end if;
  perform pg_temp.expect_move_error(creator_app, creator_team, second_team, 'Builder', 'This team has no available slots, including pending reservations.');
  if not exists (select 1 from public.team_invites where owner_application_id = creator_app and revoked_at is null) then
    raise exception 'Failed creator transfer revoked the invite';
  end if;

  perform public.move_team_member(public_app, second_team, null, null, 'Test organizer');
  if not exists (select 1 from public.applications where id = public_app and team_status = 'solo' and team_lookup is null)
      or exists (select 1 from public.team_join_requests where application_id = public_app) then
    raise exception 'Return to solo left membership state';
  end if;
  if not exists (select 1 from public.public_teams where id = second_team and occupied_slots = 1 and cardinality(member_first_names) = 0) then
    raise exception 'Return to solo did not release public roster and capacity';
  end if;
  perform public.assign_solo_to_team(public_app, first_team, 'Designer', 'Test organizer');

  perform public.move_team_member(creator_app, creator_team, second_team, 'Defender', 'Test organizer');
  if not exists (select 1 from public.team_invites where owner_application_id = creator_app and revoked_at is not null)
      or not exists (select 1 from public.applications where id = creator_app and team_status = 'joining'
        and organizer_team_invite_code is null and proposed_team_name is null and cardinality(roles_needed) = 0)
      or not exists (select 1 from public.public_teams where id = creator_team and occupied_slots = 0 and cardinality(member_roles) = 0) then
    raise exception 'Creator transfer did not clean up ownership, application, and old roster';
  end if;
  perform public.move_team_member(creator_app, second_team, null, null, 'Test organizer');
  perform public.assign_solo_to_team(creator_app, first_team, 'Builder', 'Test organizer');

  if (select count(*) from public.team_membership_changes where application_id in (private_app, public_app, creator_app)) <> 5 then
    raise exception 'Incorrect transfer history count';
  end if;
  if not exists (select 1 from public.team_membership_changes where application_id = public_app
      and from_team_id = second_team and to_team_id is null and to_team_name is null and to_role is null
      and reviewed_by = 'Test organizer') then
    raise exception 'Missing solo audit history';
  end if;
  if has_function_privilege('anon', 'public.move_team_member(uuid,uuid,uuid,text,text)', 'execute')
      or has_function_privilege('authenticated', 'public.move_team_member(uuid,uuid,uuid,text,text)', 'execute')
      or has_table_privilege('anon', 'public.team_membership_changes', 'select')
      or has_table_privilege('authenticated', 'public.team_membership_changes', 'select')
      or not has_function_privilege('service_role', 'public.move_team_member(uuid,uuid,uuid,text,text)', 'execute') then
    raise exception 'Incorrect membership permissions';
  end if;
end;
$$;
rollback;
