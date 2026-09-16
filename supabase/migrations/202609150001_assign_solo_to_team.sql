begin;

-- Organizer assignments have no invite-based owner approval. Preserve that
-- distinction while using the existing private membership record.
alter table public.team_join_requests
  add column source text not null default 'invite'
    check (source in ('invite', 'organizer')),
  alter column owner_approved_at drop not null;
alter table public.team_join_requests
  add constraint invite_owner_approval_required
    check (source <> 'invite' or owner_approved_at is not null);

create or replace function public.assign_solo_to_team(
  applicant_id uuid, team_id uuid, assigned_role text, reviewer text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  applicant applications%rowtype;
  target_team public_teams%rowtype;
  active_reservations integer;
  membership_id uuid;
begin
  if nullif(btrim(reviewer), '') is null then
    raise exception using errcode = 'P0001', message = 'Reviewer is required.';
  end if;
  if assigned_role is null or assigned_role not in ('Builder', 'Defender', 'Analyst', 'Designer', 'Strategist') then
    raise exception using errcode = 'P0001', message = 'Choose a valid team role.';
  end if;

  -- All capacity-changing join operations lock the team before counting slots.
  select * into target_team from public_teams where id = team_id for update;
  if not found or target_team.publication_status = 'archived' then
    raise exception using errcode = 'P0001', message = 'Choose an active team.';
  end if;
  select * into applicant from applications where id = applicant_id for update;
  if not found or applicant.team_status <> 'solo' then
    raise exception using errcode = 'P0001', message = 'Only solo applicants can be assigned here.';
  end if;
  if applicant.application_status <> 'approved' then
    raise exception using errcode = 'P0001', message = 'Approve the application before assigning a team.';
  end if;
  if exists (select 1 from team_join_requests where application_id = applicant_id) then
    raise exception using errcode = 'P0001', message = 'This applicant already has a team membership or join request.';
  end if;
  select count(*) into active_reservations from team_join_requests
    where public_team_id = team_id and status = 'pending' and expires_at > now();
  if target_team.occupied_slots + active_reservations >= target_team.capacity then
    raise exception using errcode = 'P0001', message = 'This team has no available slots, including pending reservations.';
  end if;

  insert into team_join_requests (
    application_id, public_team_id, desired_role, status, source,
    owner_approved_at, organizer_reviewed_by, organizer_reviewed_at
  ) values (
    applicant_id, team_id, assigned_role, 'approved', 'organizer',
    null, left(btrim(reviewer), 120), now()
  ) returning id into membership_id;

  update public_teams set
    occupied_slots = occupied_slots + 1,
    member_first_names = case when applicant.public_board_consent
      then array_append(member_first_names, split_part(btrim(applicant.full_name), ' ', 1)) else member_first_names end,
    member_roles = case when applicant.public_board_consent
      then array_append(member_roles, assigned_role) else member_roles end,
    roles_needed = array_remove(roles_needed, assigned_role), updated_at = now()
  where id = team_id;
  -- Keep the original solo application intact; membership lives in the request.
  return membership_id;
end;
$$;
revoke all on function public.assign_solo_to_team(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.assign_solo_to_team(uuid, uuid, text, text) to service_role;

commit;
