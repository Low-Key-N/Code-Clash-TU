begin;

-- Keep the recoverable invite credential on the private team record so organizers
-- can retrieve it without exposing it through the public team-board endpoint.
alter table public.public_teams
  add column if not exists organizer_invite_code text;

alter table public.public_teams
  drop constraint if exists public_teams_organizer_invite_code_check;
alter table public.public_teams
  add constraint public_teams_organizer_invite_code_check
  check (
    organizer_invite_code is null or
    char_length(organizer_invite_code) between 12 and 80
  );

create unique index if not exists public_teams_organizer_invite_code_idx
  on public.public_teams (organizer_invite_code)
  where organizer_invite_code is not null;

-- Organizer-created teams do not have an owning application, but they still need
-- an invite hash that can be consumed by reserve_team_join.
alter table public.team_invites
  alter column owner_application_id drop not null;

-- Recover the plaintext codes already stored on creator applications.
update public.public_teams pt
set organizer_invite_code = a.organizer_team_invite_code
from public.team_invites ti
join public.applications a on a.id = ti.owner_application_id
where ti.public_team_id = pt.id
  and ti.revoked_at is null
  and a.organizer_team_invite_code is not null
  and pt.organizer_invite_code is null;

create or replace function public.create_team_invite(team_id uuid, owner_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare invite_code text;
begin
  if not exists (select 1 from public_teams where id = team_id) then raise exception 'Public team not found'; end if;
  if not exists (select 1 from applications where id = owner_id and team_status = 'creating') then raise exception 'Creating-team application not found'; end if;
  invite_code := upper(encode(gen_random_bytes(9), 'hex'));
  insert into team_invites (public_team_id, owner_application_id, invite_code_hash, revoked_at)
  values (team_id, owner_id, encode(digest(invite_code, 'sha256'), 'hex'), null)
  on conflict (public_team_id) do update set owner_application_id = excluded.owner_application_id,
    invite_code_hash = excluded.invite_code_hash, created_at = now(), revoked_at = null;
  update public_teams set organizer_invite_code = invite_code, updated_at = now() where id = team_id;
  update applications set organizer_team_invite_code = invite_code, updated_at = now() where id = owner_id;
  return invite_code;
end;
$$;

create or replace function public.create_organizer_team_invite(team_id uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare invite_code text;
begin
  if not exists (select 1 from public_teams where id = team_id) then raise exception 'Public team not found'; end if;
  invite_code := upper(encode(gen_random_bytes(9), 'hex'));
  insert into team_invites (public_team_id, owner_application_id, invite_code_hash, revoked_at)
  values (team_id, null, encode(digest(invite_code, 'sha256'), 'hex'), null)
  on conflict (public_team_id) do update set owner_application_id = null,
    invite_code_hash = excluded.invite_code_hash, created_at = now(), revoked_at = null;
  update public_teams set organizer_invite_code = invite_code, updated_at = now() where id = team_id;
  return invite_code;
end;
$$;

-- Give every pre-existing team a recoverable code. Preserve creator ownership
-- where it still exists; otherwise treat the team as organizer-managed.
do $$
declare team_row record; invite_code text;
begin
  for team_row in
    select pt.id, ti.owner_application_id
    from public_teams pt
    left join team_invites ti on ti.public_team_id = pt.id and ti.revoked_at is null
    where pt.organizer_invite_code is null
  loop
    if team_row.owner_application_id is not null and exists (
      select 1 from applications
      where id = team_row.owner_application_id and team_status = 'creating'
    ) then
      invite_code := create_team_invite(team_row.id, team_row.owner_application_id);
    else
      invite_code := create_organizer_team_invite(team_row.id);
    end if;
  end loop;
end;
$$;

revoke all on function public.create_team_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_team_invite(uuid, uuid) to service_role;
revoke all on function public.create_organizer_team_invite(uuid) from public, anon, authenticated;
grant execute on function public.create_organizer_team_invite(uuid) to service_role;

commit;
