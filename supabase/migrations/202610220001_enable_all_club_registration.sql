begin;

-- Make every participating organization available in the public application
-- and use the names students will recognize in the registration dropdown.
update public.clubs
set name = case slug
  when 'bit-brothers' then 'Bit Brothers'
  when 'sister-scripters' then 'Sister Scripters'
  when 'cyber-defense-club' then 'Cyber Defense Club'
  when 'game-design-club' then 'Game Design Club'
  when 'itech' then 'iTech Club'
  when 'robotics-club' then 'Robotics Club'
  when 'software-engineering-club' then 'Software Engineering Club'
  when 'ai-club' then 'AI@TU / Towson University AI Club'
  when 'nsbe' then 'National Society of Black Engineers (NSBE)'
  when 'nsdc' then 'National Student Data Corps — Towson Chapter (NSDC)'
end,
registration_enabled = true,
updated_at = now()
where slug in (
  'bit-brothers',
  'sister-scripters',
  'cyber-defense-club',
  'game-design-club',
  'itech',
  'robotics-club',
  'software-engineering-club',
  'ai-club',
  'nsbe',
  'nsdc'
);

commit;
