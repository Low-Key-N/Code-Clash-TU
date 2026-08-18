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

The browser flag is not the security boundary. Keep the hosted Edge Function
secret `REGISTRATION_OPEN=false` while registration is closed. To open
registration, set the hosted secret to `true` and then set the browser flag to
`true`. Closing should happen in the reverse order: browser flag first, hosted
secret second.

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

## Team invite and joining workflow

After publishing a creator's team, an organizer generates its private invite
code in the SQL Editor. The plaintext code is returned only by this call and
must be sent privately to the team creator:

```sql
select public.create_team_invite(
  'PUBLIC_TEAM_ID'::uuid,
  'CREATOR_APPLICATION_ID'::uuid
);
```

Sharing the code represents the creator's approval for someone to request that
team. A joining applicant must enter a valid active code and choose one of their
desired roles. A successful submission creates a seven-day pending reservation;
invalid codes and full teams are rejected.

Organizers review pending requests with:

```sql
select r.id, pt.team_name, a.full_name, a.school_email, r.desired_role,
       r.owner_approved_at, r.expires_at
from public.team_join_requests r
join public.applications a on a.id = r.application_id
join public.public_teams pt on pt.id = r.public_team_id
where r.status = 'pending'
order by r.reserved_at;
```

Approve or reject using the request ID:

```sql
select public.approve_team_join_request('REQUEST_ID'::uuid, 'BB reviewer');
select public.reject_team_join_request('REQUEST_ID'::uuid, 'BB reviewer');
```

Approval consumes the reserved slot, removes the filled role from
`roles_needed`, and refreshes the public board automatically. If the applicant
did not grant public-board consent, occupancy increases but their name and role
remain private. Reissuing an invite invalidates the previous code.

The service-role key belongs only in Supabase Edge Function secrets. Never add
it to this repository or browser configuration.

## Credits

Designed and developed by [Keyon Bigelow](https://keyonbigelow.com/) for the CODE/CLASH planning initiative.
