begin;

-- Possession of the private invite code is the team owner's approval. Confirm
-- membership atomically during registration instead of creating a reservation
-- that needs a second organizer approval.
create or replace function public.reserve_team_join(
  application_id uuid, invite_code text, requested_role text
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  target_team public_teams%rowtype;
  applicant applications%rowtype;
  membership_id uuid;
  active_reservations integer;
begin
  select pt.* into target_team
  from team_invites ti
  join public_teams pt on pt.id = ti.public_team_id
  where ti.invite_code_hash = encode(digest(upper(btrim(invite_code)), 'sha256'), 'hex')
    and ti.revoked_at is null
    and pt.publication_status <> 'archived'
  for update of pt;
  if not found then
    raise exception 'Invalid or inactive team invite code';
  end if;

  select * into applicant
  from applications a
  where a.id = application_id
    and a.team_status = 'joining'
    and requested_role = any(a.desired_roles)
  for update;
  if not found then
    raise exception 'Joining application or requested role is invalid';
  end if;

  update team_join_requests
  set status = 'expired'
  where public_team_id = target_team.id
    and status = 'pending'
    and expires_at <= now();
  select count(*) into active_reservations
  from team_join_requests
  where public_team_id = target_team.id
    and status = 'pending'
    and expires_at > now();
  if target_team.occupied_slots + active_reservations >= target_team.capacity then
    raise exception 'Team has no available slots';
  end if;

  insert into team_join_requests (
    application_id, public_team_id, desired_role, status, source, owner_approved_at
  ) values (
    application_id, target_team.id, requested_role, 'approved', 'invite', now()
  ) returning id into membership_id;

  update public_teams set
    occupied_slots = occupied_slots + 1,
    member_first_names = case when applicant.public_board_consent
      then array_append(member_first_names, split_part(btrim(applicant.full_name), ' ', 1))
      else member_first_names end,
    member_roles = case when applicant.public_board_consent
      then array_append(member_roles, requested_role)
      else member_roles end,
    roles_needed = array_remove(roles_needed, requested_role),
    updated_at = now()
  where id = target_team.id;

  return membership_id;
end;
$$;

revoke all on function public.reserve_team_join(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_team_join(uuid, text, text) to service_role;

commit;
