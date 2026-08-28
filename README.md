# CODE/CLASH
**Ideas Assemble.**

CODE/CLASH is a proposed 24-hour student hackathon presented by Bit Brothers at Towson University. The event is designed to bring students from different technical and creative backgrounds together to build, learn, collaborate, and turn ambitious ideas into working projects.

## Live Preview

[View the CODE/CLASH website](https://codeclashtu.com/)

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

## Private organizer dashboard

The static dashboard lives at `/admin/` and uses Supabase email/password Auth.
Knowing the URL does not grant access: `organizer-admin` validates the access
token with Supabase Auth, then independently requires the authenticated user ID
to exist as `public.organizers.user_id`. The login email and verified identity
belong to the linked `auth.users` row; they are intentionally not duplicated in the
organizer profile table. Private table access remains revoked from
`anon` and `authenticated`; only the Edge Function uses `service_role` after
authorization succeeds.

The service role has a narrow column-level grant on
`public.organizers(user_id, display_name)` so the Edge Function can perform the
allowlist lookup. Browser roles have no direct access to that table.

The dashboard supports application counts, searchable review queues, full
application details, approve/waitlist/reject decisions, confirmed application
deletion, private notes, CSV export, and public-team create/edit/publish/archive/delete workflows. Approving an application marked `creating`
automatically creates a private draft team and owner invite code. Organizer
access cannot be changed through the dashboard.

Applications marked `joining` create a pending team reservation after their
invite is validated. The application detail view shows its requested team,
role, expiration, and capacity. Approving the join request adds the participant
to the team; rejecting it releases the pending request without exposing the
invite code.

The current owner invite code remains visible on the private application detail
record so an organizer can retrieve it later. It is excluded from public APIs
and CSV exports. Approving a legacy creating-team application with only a hashed
invite rotates that invite once and stores the replacement code privately.

### Review and deploy the organizer dashboard

Do not deploy blindly. First review:

- `supabase/migrations/202608270001_organizer_admin_dashboard.sql`
- `supabase/functions/organizer-admin/index.ts`
- `admin/admin.js`

The public site is currently configured for open registration. The protected
submission function must use the matching hosted control:

```bash
npx supabase secrets set REGISTRATION_OPEN=true
```

`supabase-config.js` must also contain `registrationOpen: true`. To close
registration safely, switch the browser flag to `false` first and then set the
hosted secret to `false`.

Link the production project and preview the migration:

```bash
npx supabase login
npx supabase link --project-ref ialynpqpmjwqzbjplpsi
npx supabase db push --dry-run
```

After reviewing the generated SQL, apply the migration:

```bash
npx supabase db push
```

Set exact production and local-development origins. The local origin below is
used with `python -m http.server 8000`; do not use `*`:

```bash
npx supabase secrets set ALLOWED_ORIGINS=https://codeclashtu.com,http://localhost:8000
```

Deploy only the protected function. JWT gateway verification is disabled so
the function can return controlled 401/403 responses; the function itself
calls Supabase Auth to validate every JWT before checking `public.organizers`:

```bash
npx supabase functions deploy organizer-admin --no-verify-jwt
```

### Create or approve an organizer

Create the account in **Supabase Dashboard → Authentication → Users** with a
confirmed email and password. Then, in the SQL Editor, add that exact Auth user to the
existing organizer allowlist:

```sql
insert into public.organizers (user_id, display_name)
select id, coalesce(nullif(raw_user_meta_data ->> 'display_name', ''), split_part(email, '@', 1))
from auth.users
where lower(email) = lower('organizer@example.com')
on conflict (user_id) do nothing;
```

Do not put organizer passwords, access tokens, or the service-role key in this
repository. Remove access only through the Supabase SQL Editor after confirming
that another organizer remains:

```sql
delete from public.organizers
where user_id = (select id from auth.users where lower(email) = lower('former-organizer@example.com'));
```

### Local and security testing

Serve the repository instead of opening the HTML directly:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000/admin/` and verify, in order:

1. A valid organizer can sign in and restore a refreshed session.
2. Incorrect credentials receive an authentication error without sending email.
3. A valid Auth user absent from `public.organizers` receives HTTP 403.
4. A missing, expired, or altered token receives HTTP 401.
5. An origin outside `ALLOWED_ORIGINS` receives HTTP 403, including preflight.
6. Application search, details, each review status, and private notes work.
7. CSV cells beginning with spreadsheet formulas are escaped on export.
8. A team can be created, edited, published, archived, and deleted only after
   the applicable confirmation prompt.
9. The public site returns only published fields from `list-public-teams` and
   never exposes email, phone, accommodations, dietary, or organizer-note data.
10. Direct REST reads of private tables with the publishable key remain denied.

After deployment, inspect Edge Function logs for authorization or database
errors without logging tokens or private application bodies.

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
   (the production origin is `https://codeclashtu.com`).
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
