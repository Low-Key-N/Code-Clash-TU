begin;

-- A private invite is the authorization to join a team; publishing only controls
-- whether that team appears on the public board. Draft teams are still active and
-- can already receive organizer-assigned members, so their invite codes must work.
create or replace function public.reserve_team_join(
  application_id uuid, invite_code text, requested_role text
)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  target_team public_teams%rowtype;
  request_id uuid;
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
  if not exists (
    select 1 from applications a
    where a.id = application_id
      and a.team_status = 'joining'
      and requested_role = any(a.desired_roles)
  ) then
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

  insert into team_join_requests (application_id, public_team_id, desired_role, owner_approved_at)
  values (application_id, target_team.id, requested_role, now())
  returning id into request_id;
  return request_id;
end;
$$;

revoke all on function public.reserve_team_join(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_team_join(uuid, text, text) to service_role;

commit;
