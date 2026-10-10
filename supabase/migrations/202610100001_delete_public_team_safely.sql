begin;

create or replace function public.delete_public_team(team_id uuid, reviewer text)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_team public_teams%rowtype;
begin
  if nullif(btrim(reviewer), '') is null then raise exception 'Reviewer is required'; end if;

  select * into target_team from public_teams where id = team_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'Team not found.'; end if;

  insert into team_membership_changes (
    application_id, from_team_id, from_team_name, from_role,
    to_team_id, to_team_name, to_role, reviewed_by
  )
  select member.application_id, target_team.id, target_team.team_name, member.role,
    null, null, null, left(btrim(reviewer), 120)
  from (
    select ti.owner_application_id as application_id, coalesce(a.desired_roles[1], 'Builder') as role
    from team_invites ti join applications a on a.id = ti.owner_application_id
    where ti.public_team_id = team_id and ti.revoked_at is null
    union
    select tjr.application_id, tjr.desired_role
    from team_join_requests tjr
    where tjr.public_team_id = team_id and tjr.status = 'approved'
  ) member;

  update applications set
    team_status = 'solo', proposed_team_name = null, roles_needed = '{}', team_lookup = null,
    organizer_team_invite_code = null, updated_at = now()
  where id in (
    select owner_application_id from team_invites where public_team_id = team_id
    union
    select application_id from team_join_requests where public_team_id = team_id
  );

  delete from public_teams where id = team_id;
end;
$$;

revoke all on function public.delete_public_team(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_public_team(uuid, text) to service_role;

commit;
