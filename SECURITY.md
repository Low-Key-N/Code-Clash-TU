# Code/Clash website security

This repository is a static website. Everything committed here and delivered by
GitHub Pages is public, including HTML, CSS, JavaScript, images, and source maps.

## Secrets

Never add API keys, passwords, form tokens, private spreadsheet URLs, or
credentials to this repository. Local `.env` files are ignored as a guardrail,
but a `.env` file does not make secrets usable or private in browser code.

If a future feature needs a secret, place it in a controlled backend or
serverless function and expose only a narrowly scoped public endpoint.

## Participant and team data

Only approved public fields should reach this website. Do not expose raw form
responses, email addresses, phone numbers, student IDs, or private spreadsheet
data.

The team board must read only published rows from the organizer-curated
`public_teams` projection through the read-only Edge Function. Direct browser
access to application and team tables remains revoked. Publication requires an
organizer review and the applicant's public-board consent.

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
