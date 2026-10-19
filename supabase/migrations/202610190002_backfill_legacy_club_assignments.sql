begin;

-- Map recognizable legacy free-text answers to canonical clubs. The original
-- response remains untouched in student_organization_original, and ambiguous
-- answers remain unassigned for organizer review in the admin panel.
with legacy_assignments as (
  select
    application.id as application_id,
    case lower(regexp_replace(btrim(application.student_organization_original), '[^a-z0-9]+', '', 'g'))
      when 'bitbrothers' then 'bit-brothers'
      when 'bitbrother' then 'bit-brothers'
      when 'bb' then 'bit-brothers'
      when 'sisterscripters' then 'sister-scripters'
      when 'sisterscripter' then 'sister-scripters'
      when 'itech' then 'itech'
      when 'informationtechnologyclub' then 'itech'
      when 'softwareengineeringclub' then 'software-engineering-club'
      when 'sec' then 'software-engineering-club'
      when 'robotics' then 'robotics-club'
      when 'roboticsclub' then 'robotics-club'
      when 'gamedesign' then 'game-design-club'
      when 'gamedesignclub' then 'game-design-club'
      when 'cyberdefense' then 'cyber-defense-club'
      when 'cyberdefenseclub' then 'cyber-defense-club'
      when 'nsbe' then 'nsbe'
      when 'nationalsocietyofblackengineers' then 'nsbe'
      when 'aiclub' then 'ai-club'
      when 'artificialintelligenceclub' then 'ai-club'
      when 'nsdc' then 'nsdc'
      when 'nationalsocietyofdiversecomputing' then 'nsdc'
      else null
    end as club_slug
  from public.applications application
  where application.student_organization_id is null
)
update public.applications application
set
  student_organization_id = club.id,
  student_organization = club.name,
  updated_at = now()
from legacy_assignments legacy
join public.clubs club on club.slug = legacy.club_slug and club.active
where application.id = legacy.application_id
  and legacy.club_slug is not null
  and application.student_organization_id is null;

commit;
