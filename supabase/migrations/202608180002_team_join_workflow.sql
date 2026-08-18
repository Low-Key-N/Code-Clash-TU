begin;

create extension if not exists pgcrypto;

alter table public.public_teams add column if not exists occupied_slots smallint;
update public.public_teams set occupied_slots = cardinality(member_roles) where occupied_slots is null;
alter table public.public_teams alter column occupied_slots set default 0;
alter table public.public_teams alter column occupied_slots set not null;
alter table public.public_teams drop constraint if exists public_team_occupied_slots;
alter table public.public_teams add constraint public_team_occupied_slots check (occupied_slots between 0 and capacity);

create table public.team_invites (
  id uuid primary key default gen_random_uuid(),
  public_team_id uuid not null unique references public.public_teams(id) on delete cascade,
  owner_application_id uuid not null references public.applications(id) on delete cascade,
  invite_code_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.team_invites enable row level security;
revoke all on public.team_invites from anon, authenticated;

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  public_team_id uuid not null references public.public_teams(id) on delete cascade,
  desired_role text not null check (desired_role in ('Builder', 'Defender', 'Analyst', 'Designer', 'Strategist')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  owner_approved_at timestamptz not null,
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  organizer_reviewed_by text,
  organizer_reviewed_at timestamptz
);
alter table public.team_join_requests enable row level security;
revoke all on public.team_join_requests from anon, authenticated;

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
  return invite_code;
end;
$$;
revoke all on function public.create_team_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_team_invite(uuid, uuid) to service_role;

create or replace function public.reserve_team_join(application_id uuid, invite_code text, requested_role text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare target_team public_teams%rowtype; request_id uuid; active_reservations integer;
begin
  select pt.* into target_team from team_invites ti join public_teams pt on pt.id = ti.public_team_id
  where ti.invite_code_hash = encode(digest(upper(btrim(invite_code)), 'sha256'), 'hex')
    and ti.revoked_at is null and pt.publication_status = 'published' for update of pt;
  if not found then raise exception 'Invalid or inactive team invite code'; end if;
  if not exists (select 1 from applications a where a.id = application_id and a.team_status = 'joining' and requested_role = any(a.desired_roles)) then
    raise exception 'Joining application or requested role is invalid';
  end if;
  update team_join_requests set status = 'expired' where public_team_id = target_team.id and status = 'pending' and expires_at <= now();
  select count(*) into active_reservations from team_join_requests where public_team_id = target_team.id and status = 'pending' and expires_at > now();
  if target_team.occupied_slots + active_reservations >= target_team.capacity then raise exception 'Team has no available slots'; end if;
  insert into team_join_requests (application_id, public_team_id, desired_role, owner_approved_at)
  values (application_id, target_team.id, requested_role, now()) returning id into request_id;
  return request_id;
end;
$$;
revoke all on function public.reserve_team_join(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_team_join(uuid, text, text) to service_role;

create or replace function public.approve_team_join_request(request_id uuid, reviewer text)
returns void language plpgsql security definer set search_path = public as $$
declare request_row team_join_requests%rowtype; applicant applications%rowtype; target_team public_teams%rowtype;
begin
  if nullif(btrim(reviewer), '') is null then raise exception 'Reviewer is required'; end if;
  select * into request_row from team_join_requests where id = request_id for update;
  if not found or request_row.status <> 'pending' then raise exception 'Pending join request not found'; end if;
  if request_row.expires_at <= now() then update team_join_requests set status = 'expired' where id = request_id; raise exception 'Join reservation expired'; end if;
  select * into target_team from public_teams where id = request_row.public_team_id for update;
  if target_team.occupied_slots >= target_team.capacity then raise exception 'Team is full'; end if;
  select * into applicant from applications where id = request_row.application_id;
  update public_teams set
    occupied_slots = occupied_slots + 1,
    member_first_names = case when applicant.public_board_consent then array_append(member_first_names, split_part(applicant.full_name, ' ', 1)) else member_first_names end,
    member_roles = case when applicant.public_board_consent then array_append(member_roles, request_row.desired_role) else member_roles end,
    roles_needed = array_remove(roles_needed, request_row.desired_role), updated_at = now()
  where id = target_team.id;
  update team_join_requests set status = 'approved', organizer_reviewed_by = left(btrim(reviewer), 120), organizer_reviewed_at = now() where id = request_id;
end;
$$;
revoke all on function public.approve_team_join_request(uuid, text) from public, anon, authenticated;
grant execute on function public.approve_team_join_request(uuid, text) to service_role;

create or replace function public.reject_team_join_request(request_id uuid, reviewer text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if nullif(btrim(reviewer), '') is null then raise exception 'Reviewer is required'; end if;
  update team_join_requests set status = 'rejected', organizer_reviewed_by = left(btrim(reviewer), 120), organizer_reviewed_at = now()
  where id = request_id and status = 'pending';
  if not found then raise exception 'Pending join request not found'; end if;
end;
$$;
revoke all on function public.reject_team_join_request(uuid, text) from public, anon, authenticated;
grant execute on function public.reject_team_join_request(uuid, text) to service_role;

grant delete on public.applications to service_role;
grant execute on function public.reserve_team_join(uuid, text, text) to service_role;

commit;
