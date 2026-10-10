begin;

do $$
declare
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  target_team_id uuid := gen_random_uuid();
begin
  insert into public.applications (
    id, full_name, school_email, school, major, graduation_year, experience_level,
    desired_roles, project_interests, team_status, proposed_team_name, roles_needed,
    team_lookup, public_board_consent, agreed_to_rules_at, confirmed_accurate_at
  ) values
    (owner_id, 'Owner Example', 'delete-owner@example.edu', 'Towson University', 'Computer Science', 2027, 'Beginner',
      array['Builder'], 'A project worth testing', 'creating', 'Delete Test Team', array['Designer'], null, true, now(), now()),
    (member_id, 'Member Example', 'delete-member@example.edu', 'Towson University', 'Design', 2027, 'Beginner',
      array['Designer'], 'Another project idea', 'joining', null, '{}', 'Delete Test Team', true, now(), now());

  insert into public.public_teams (
    id, team_name, member_first_names, member_roles, capacity, occupied_slots
  ) values (target_team_id, 'Delete Test Team', array['Owner', 'Member'], array['Builder', 'Designer'], 4, 2);

  insert into public.team_invites (public_team_id, owner_application_id, invite_code_hash)
  values (target_team_id, owner_id, 'delete-test-invite-hash');

  insert into public.team_join_requests (
    application_id, public_team_id, desired_role, status, owner_approved_at
  ) values (member_id, target_team_id, 'Designer', 'approved', now());

  perform public.delete_public_team(target_team_id, 'delete-test@example.edu');

  if exists (select 1 from public.public_teams where id = target_team_id) then
    raise exception 'The team was not deleted';
  end if;
  if exists (
    select 1 from public.applications
    where id in (owner_id, member_id)
      and (team_status <> 'solo' or proposed_team_name is not null or team_lookup is not null or cardinality(roles_needed) <> 0)
  ) then
    raise exception 'Deleted-team applicants were not returned to solo';
  end if;
  if (select count(*) from public.team_membership_changes where application_id in (owner_id, member_id) and to_team_id is null) <> 2 then
    raise exception 'Deleted-team membership history was not recorded';
  end if;
end;
$$;

rollback;
