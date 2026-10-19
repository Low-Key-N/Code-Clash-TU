begin;

-- Registration is currently open only to the two organizing clubs. Other
-- clubs remain active so organizers can enable them later without recreating
-- records or losing historical assignments.
alter table public.clubs
  add column if not exists registration_enabled boolean not null default false;

update public.clubs
set registration_enabled = slug in ('bit-brothers', 'nsbe');

-- Restore one organization per person using the canonical assignment already
-- stored on each application. This removes the mistaken extra legacy credit.
delete from public.application_club_memberships membership
using public.applications application
where membership.application_id = application.id
  and membership.club_id is distinct from application.student_organization_id;

insert into public.application_club_memberships (application_id, club_id, source)
select application.id, application.student_organization_id, 'organizer'
from public.applications application
where application.student_organization_id is not null
on conflict do nothing;

create unique index if not exists application_club_memberships_one_club_per_application
  on public.application_club_memberships (application_id);

drop function if exists public.set_application_clubs(uuid, uuid[], text);

create or replace function public.set_application_club(
  applicant_id uuid,
  selected_club_id uuid,
  reviewer text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_club clubs%rowtype;
begin
  if nullif(btrim(reviewer), '') is null then raise exception 'Reviewer is required.'; end if;
  if not exists (select 1 from applications where id = applicant_id for update) then raise exception 'Application not found.'; end if;

  if selected_club_id is not null then
    select club.* into selected_club
    from clubs club
    where club.id = selected_club_id and club.active;
    if not found then raise exception 'That club is invalid or inactive.'; end if;
  end if;

  delete from application_club_memberships where application_id = applicant_id;
  if selected_club_id is not null then
    insert into application_club_memberships (application_id, club_id, source, assigned_by)
    values (applicant_id, selected_club_id, 'organizer', left(btrim(reviewer), 120));
  end if;

  update applications set
    student_organization_id = selected_club_id,
    student_organization = coalesce(selected_club.name, 'None'),
    updated_at = now()
  where id = applicant_id;
end;
$$;

revoke all on function public.set_application_club(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_application_club(uuid, uuid, text) to service_role;

commit;
