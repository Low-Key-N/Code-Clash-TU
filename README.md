# CODE/CLASH
**Ideas Assemble.**

CODE/CLASH is a proposed 24-hour student hackathon presented by Bit Brothers at Towson University. The event is designed to bring students from different technical and creative backgrounds together to build, learn, collaborate, and turn ambitious ideas into working projects.

## Live Preview

[View the CODE/CLASH website](https://low-key-n.github.io/TowsonHackathonWebsite/)

> **Concept Preview:** CODE/CLASH is currently in the planning stage. Dates, venue, programming, registration, partnerships, and other event details are subject to approval and change.

## Website Features

- Comic-inspired visual identity
- Responsive one-page layout
- Event countdown
- Participant role system
- Assembly Queue team concept
- Proposed schedule, FAQ, and sponsor sections
- Future registration and Devpost integration

## Built With

- HTML
- CSS
- JavaScript
- GitHub Pages

## Project Status

This website is an early design and development prototype created to collect feedback from the Bit Brothers hackathon planning team. Registration is not currently open.

## Secure application deployment

The application form is closed by default. The production database contains a
legacy, manually-created schema. Before deployment, verify in the Supabase SQL
Editor that both checks return zero:

```sql
select count(*) from public.applications;
select count(*) from public.participants where application_id is not null;
```

The migration repeats those checks inside a transaction and aborts before
dropping anything if either check is nonzero or an unexpected table references
`applications`. It explicitly removes only the known participant foreign key
and uses a non-cascading drop, so any unknown dependency aborts the transaction.
It preserves `participants` and rebuilds its `application_id` foreign key after
replacing the empty legacy table. It also removes legacy
application policies and revokes direct `anon`/`authenticated` access.

Before setting `registrationOpen` to `true` in `supabase-config.js`:

1. Link the Supabase CLI, run `supabase db push --dry-run`, review the output,
   and then run `supabase db push`.
2. Generate a long random value and save it with
   `supabase secrets set RATE_LIMIT_SALT=...`.
3. Set `ALLOWED_ORIGINS` to a comma-separated list of exact production origins
   (the default is `https://low-key-n.github.io`).
4. Deploy with `supabase functions deploy submit-application` and
   `supabase functions deploy list-public-teams`.
5. Submit a test application; verify duplicate-email, honeypot, validation, and
   30-attempt-per-source/hour responses; and
   confirm that the `anon` and `authenticated` roles cannot read or write the
   `applications`, `application_rate_limits`, or `public_teams` tables.

## Publishing assembled teams

The public board reads only organizer-reviewed rows from `public_teams`; it
never reads `applications`, `participants`, `teams`, or `team_members`.
Organizers should create a draft using only applicants who granted public-board
consent, copy only approved first names, roles, team name, needed roles, and
project interests, and review the row before publishing it. A row becomes
visible only after setting `publication_status = 'published'`, `reviewed_by`,
and `published_at`. Archive a row to remove it from the board.

Use the restricted `publish_public_team(team_id, reviewer)` and
`archive_public_team(team_id)` functions from an organizer-only backend or the
Supabase SQL Editor. They are not executable by `anon` or `authenticated`.

Do not copy email addresses, phone numbers, pronouns, dietary restrictions,
accessibility accommodations, organization affiliations, or application notes
into `public_teams`.

The service-role key belongs only in Supabase Edge Function secrets. Never add
it to this repository or browser configuration.

## Credits

Designed and developed by [Keyon Bigelow](https://keyonbigelow.com/) for the CODE/CLASH planning initiative.
