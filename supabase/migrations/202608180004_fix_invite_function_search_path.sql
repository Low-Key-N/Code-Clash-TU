begin;
alter function public.create_team_invite(uuid, uuid) set search_path = public, extensions;
alter function public.reserve_team_join(uuid, text, text) set search_path = public, extensions;
commit;
