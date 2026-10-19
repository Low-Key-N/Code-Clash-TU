begin;

-- This follow-up is safe whether or not the Club Challenge migration has
-- already run. Existing free-text answers are copied before organizers begin
-- assigning applicants to canonical clubs.
alter table public.applications
  add column if not exists student_organization_original text;

update public.applications
set student_organization_original = student_organization
where student_organization_original is null;

alter table public.applications
  alter column student_organization_original set default 'None',
  alter column student_organization_original set not null;

alter table public.applications
  drop constraint if exists applications_student_organization_original_length;
alter table public.applications
  add constraint applications_student_organization_original_length
  check (char_length(student_organization_original) <= 150);

grant select on public.applications to service_role;

commit;
