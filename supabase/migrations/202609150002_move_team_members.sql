begin;

create table public.team_membership_changes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  from_team_id uuid references public.public_teams(id) on delete set null,
  from_team_name text not null,
  from_role text not null,
  to_team_id uuid references public.public_teams(id) on delete set null,
  to_team_name text,
  to_role text,
  reviewed_by text not null,
  created_at timestamptz not null default now()
);
create index team_membership_changes_application_idx
  on public.team_membership_changes(application_id, created_at desc);
alter table public.team_membership_changes enable row level security;
revoke all on public.team_membership_changes from public, anon, authenticated;
grant select on public.team_membership_changes to service_role;

create or replace function public.move_team_member(
  applicant_id uuid, expected_team_id uuid, destination_team_id uuid,
  assigned_role text, reviewer text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  applicant applications%rowtype;
  membership team_join_requests%rowtype;
  old_team public_teams%rowtype;
  new_team public_teams%rowtype;
  current_team_id uuid;
  previous_role text;
  creator boolean := false;
  reservations integer;
  public_index integer;
begin
  if nullif(btrim(reviewer), '') is null then raise exception 'Reviewer is required.'; end if;
  if expected_team_id is null then raise exception 'The current team is required. Reopen the application.'; end if;
  if destination_team_id = expected_team_id then raise exception 'Choose a different team or return the participant to solo.'; end if;
  if destination_team_id is not null and (assigned_role is null or assigned_role not in ('Builder', 'Defender', 'Analyst', 'Designer', 'Strategist')) then
    raise exception 'Choose a valid team role.';
  end if;

  -- Lock both teams in UUID order so simultaneous transfers share one lock order.
  perform id from public_teams where id in (expected_team_id, destination_team_id) order by id for update;
  select * into old_team from public_teams where id = expected_team_id;
  if not found then raise exception 'The current team no longer exists. Reopen the application.'; end if;
  select * into applicant from applications where id = applicant_id for update;
  if not found then raise exception 'Application not found.'; end if;
  select * into membership from team_join_requests where application_id = applicant_id for update;
  if found then
    if membership.status <> 'approved' then raise exception 'This applicant does not have an approved team membership.'; end if;
    current_team_id := membership.public_team_id;
    previous_role := membership.desired_role;
  elsif applicant.team_status = 'creating' then
    -- Creators occupy a slot through their owner invite, rather than a join request.
    if (select count(*) from team_invites where owner_application_id = applicant_id) <> 1 then
      raise exception 'The creator team could not be identified uniquely.';
    end if;
    select public_team_id into current_team_id from team_invites where owner_application_id = applicant_id;
    previous_role := applicant.desired_roles[1];
    creator := true;
  end if;
  if current_team_id is distinct from expected_team_id then
    raise exception 'Team membership changed. Reopen the application before moving this participant.';
  end if;
  if old_team.occupied_slots < 1 then raise exception 'The current team occupancy needs correction before moving this participant.'; end if;

  if destination_team_id is not null then
    select * into new_team from public_teams where id = destination_team_id;
    if not found or new_team.publication_status = 'archived' then raise exception 'Choose an active destination team.'; end if;
    select count(*) into reservations from team_join_requests
      where public_team_id = destination_team_id and status = 'pending' and expires_at > now();
    if new_team.occupied_slots + reservations >= new_team.capacity then
      raise exception 'This team has no available slots, including pending reservations.';
    end if;
  end if;

  -- Remove just one paired public entry, even when two members share a name.
  if applicant.public_board_consent then
    select i into public_index from generate_subscripts(old_team.member_first_names, 1) i
      where old_team.member_first_names[i] = split_part(btrim(applicant.full_name), ' ', 1)
        and old_team.member_roles[i] = previous_role order by i limit 1;
  end if;
  if public_index is not null then
    old_team.member_first_names := old_team.member_first_names[1:public_index-1] || old_team.member_first_names[public_index+1:cardinality(old_team.member_first_names)];
    old_team.member_roles := old_team.member_roles[1:public_index-1] || old_team.member_roles[public_index+1:cardinality(old_team.member_roles)];
  end if;
  if cardinality(old_team.member_roles) > old_team.occupied_slots - 1 then
    raise exception 'The public roster does not match this membership. Correct the team roster before moving this participant.';
  end if;
  update public_teams set occupied_slots = occupied_slots - 1,
    member_first_names = old_team.member_first_names, member_roles = old_team.member_roles,
    roles_needed = case when previous_role = any(roles_needed) then roles_needed else array_append(roles_needed, previous_role) end,
    updated_at = now() where id = expected_team_id;

  if creator then
    update team_invites set revoked_at = now() where owner_application_id = applicant_id;
  end if;
  if destination_team_id is null then
    delete from team_join_requests where application_id = applicant_id;
  else
    update public_teams set occupied_slots = occupied_slots + 1,
      member_first_names = case when applicant.public_board_consent then array_append(member_first_names, split_part(btrim(applicant.full_name), ' ', 1)) else member_first_names end,
      member_roles = case when applicant.public_board_consent then array_append(member_roles, assigned_role) else member_roles end,
      roles_needed = array_remove(roles_needed, assigned_role), updated_at = now()
    where id = destination_team_id;
    insert into team_join_requests (
      application_id, public_team_id, desired_role, status, source, owner_approved_at,
      organizer_reviewed_by, organizer_reviewed_at
    ) values (applicant_id, destination_team_id, assigned_role, 'approved', 'organizer', null, left(btrim(reviewer), 120), now())
    on conflict (application_id) do update set
      public_team_id = excluded.public_team_id, desired_role = excluded.desired_role,
      status = 'approved', source = 'organizer', owner_approved_at = null,
      reserved_at = now(), expires_at = now(),
      organizer_reviewed_by = excluded.organizer_reviewed_by, organizer_reviewed_at = now();
  end if;
  update applications set
    team_status = case when destination_team_id is null then 'solo' else 'joining' end,
    team_lookup = case when destination_team_id is null then null else new_team.team_name end,
    proposed_team_name = null, roles_needed = '{}', organizer_team_invite_code = null, updated_at = now()
  where id = applicant_id;
  insert into team_membership_changes (
    application_id, from_team_id, from_team_name, from_role,
    to_team_id, to_team_name, to_role, reviewed_by
  ) values (applicant_id, expected_team_id, old_team.team_name, previous_role,
    destination_team_id, new_team.team_name, case when destination_team_id is null then null else assigned_role end, left(btrim(reviewer), 120));
end;
$$;
revoke all on function public.move_team_member(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.move_team_member(uuid, uuid, uuid, text, text) to service_role;

commit;
