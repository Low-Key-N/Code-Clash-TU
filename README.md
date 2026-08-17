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

The application form is closed by default. Before setting `registrationOpen` to
`true` in `supabase-config.js`:

1. Link the Supabase CLI to the production project and run `supabase db push`.
2. Generate a long random value and save it with
   `supabase secrets set RATE_LIMIT_SALT=...`.
3. Set `ALLOWED_ORIGINS` to a comma-separated list of exact production origins
   (the default is `https://low-key-n.github.io`).
4. Deploy with `supabase functions deploy submit-application`.
5. Submit a test application, verify duplicate and rate-limit responses, and
   confirm that the `anon` and `authenticated` roles cannot read or write the
   `applications` or `application_rate_limits` tables.

The service-role key belongs only in Supabase Edge Function secrets. Never add
it to this repository or browser configuration.

## Credits

Designed and developed by [Keyon Bigelow](https://keyonbigelow.com/) for the CODE/CLASH planning initiative.
