begin;

-- The first membership backfill normalized after stripping characters, which
-- caused capital letters in legacy answers to be discarded. Normalize case
-- first so answers such as "Bit brothers, NSBE" credit both organizations.
with legacy_tokens as (
  select
    application.id as application_id,
    regexp_replace(lower(btrim(token.value)), '[^a-z0-9]+', '', 'g') as normalized
  from public.applications application
  cross join lateral regexp_split_to_table(application.student_organization_original, '[,;/&]+') token(value)
), legacy_slugs as (
  select
    application_id,
    case normalized
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
  from legacy_tokens
)
insert into public.application_club_memberships (application_id, club_id, source)
select legacy.application_id, club.id, 'legacy'
from legacy_slugs legacy
join public.clubs club on club.slug = legacy.club_slug and club.active
where legacy.club_slug is not null
on conflict do nothing;

commit;
