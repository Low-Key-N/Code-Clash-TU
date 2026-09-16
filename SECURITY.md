# Code/Clash website security

This repository is a static website. Everything committed here and delivered by
GitHub Pages is public, including HTML, CSS, JavaScript, images, and source maps.

## Secrets

Never add API keys, passwords, form tokens, private spreadsheet URLs, or
credentials to this repository. Local `.env` files are ignored as a guardrail,
but a `.env` file does not make secrets usable or private in browser code.

If a future feature needs a secret, place it in a controlled backend or
serverless function and expose only a narrowly scoped public endpoint.

The tracked backend source and SQL migrations contain application logic, not
production credentials or participant records. Keep that code versioned. The
Supabase publishable key in `supabase-config.js` is intended for browser use;
service-role keys, secret keys, and participant data must stay outside Git.

`.gitignore` excludes local environment files, credential/key files, spreadsheet
exports, common database dumps, logs, and browser authentication artifacts.
Store any other private working files under `/private/`, `/exports/`,
`/backups/`, `/secrets/`, or `/credentials/`, which are also ignored. Arbitrary
JSON or SQL filenames elsewhere are not automatically private; actual schema
migrations and tests remain tracked. Never force-add private files.

Ignore rules only prevent untracked files from being added normally. They do
not encrypt files, protect browser-delivered code, remove already tracked data,
or erase Git history. Before committing, review staged changes with
`git diff --cached` and check exclusions with `git check-ignore -v PATH`.
If a credential was committed, rotate it and address the existing Git history;
adding an ignore rule is not sufficient.

## Participant and team data

Only approved public fields should reach this website. Do not expose raw form
responses, email addresses, phone numbers, student IDs, or private spreadsheet
data.

The team board must read only published rows from the organizer-curated
`public_teams` projection through the read-only Edge Function. Direct browser
access to application and team tables remains revoked. Publication requires an
organizer review and the applicant's public-board consent.

Team invite codes are stored only as SHA-256 hashes. A valid code represents
team-owner authorization to request membership, reserves capacity for seven
days, and still requires organizer approval. Join requests and invite records
have RLS enabled with no direct `anon` or `authenticated` privileges.

For organizer retrieval, the current plaintext invite code is also attached to
the private `applications` row after approval. It is available only through the
organizer-authorized Edge Function, is never returned by the public team API,
and is intentionally omitted from CSV exports. Treat it as a private team
credential and send it only to the approved team owner.

Render plain user-provided values with `textContent`. Do not pass them to
`innerHTML`, `outerHTML`, or `insertAdjacentHTML`. If rich text ever becomes a
requirement, sanitize it on the server and again with a maintained HTML
sanitizer before rendering.

Validate user-provided links before assigning them to `href`. Accept only
explicitly approved protocols and hosts. External links opened in a new tab
must use `rel="noopener noreferrer"`.

## Deployment headers

The HTML includes a restrictive Content Security Policy for static hosting.
When hosting moves to a platform that supports response headers, migrate the
policy to the HTTP `Content-Security-Policy` header and add:

- `frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy` with unneeded capabilities disabled
- `Strict-Transport-Security` after confirming the entire domain is HTTPS-only

Server-side registration or team APIs must additionally implement
authentication where needed, schema validation, request-size limits, rate
limiting, safe database queries, logging, and abuse monitoring.

## Organizer dashboard

The `/admin/` path is publicly discoverable because GitHub Pages is static. Its
privacy boundary is the `organizer-admin` Edge Function, not the absence of a
navigation link. The function validates the Supabase access token and then
checks the authenticated user ID against `public.organizers.user_id` before constructing
a service-role client. Invalid sessions receive 401 and authenticated users not
on the organizer allowlist receive 403.

Dashboard login uses Supabase email/password authentication. The UUID in
`public.organizers.user_id` is an identifier, not a credential, and is never
accepted as proof of identity.

The browser contains only the Supabase project URL and publishable key. Never
add the service-role key to `supabase-config.js`, `admin/admin.js`, repository
secrets, logs, screenshots, or CSV exports. Keep private-table grants revoked
from `anon` and `authenticated`, and keep allowed origins exact rather than
using a wildcard.

## Applicant email verification

Registration requires a recent Supabase email OTP/magic-link session. The
submission function validates the access token with Auth, requires a confirmed
email and recent inbox authentication, and rejects an email different from the
verified account. Registration uses email-only Auth accounts (application phone
numbers are separate private fields). Password-only and anonymous sessions are
not accepted. Access tokens stay in browser memory; callback tokens are removed
from the URL immediately and refresh tokens are not retained.

Successful new and duplicate submissions return the same receipt. Existing
applications are never overwritten by a duplicate. The rate limiter uses the
verified Auth user ID with a private salt, not caller-controlled IP headers.
Supabase Auth's own OTP limits protect verification-link requests. Configure
production SMTP, enable Confirm Email and secure email changes, and keep signup
and email sending rate limits appropriate for the event before opening registration.
No client-side flag can bypass these server checks.
