# Supabase and Cloudflare deployment handoff

## Current status (July 22, 2026)

- Supabase project `rvylugnfclguwhdvxprn` is linked and healthy.
- Local and remote migration history match through `202607220004`.
- James is verified as the original Owner and administrator.
- Supabase Auth is reachable and public signup is enabled.
- `npm run check`, `npm run check:supabase`, and `npm run build` pass.
- GitHub/Cloudflare Pages connection and the final `pages.dev` redirect URL remain to be configured.

The repository contains the production Supabase database, browser adapter, Cloudflare security headers, and a clean static build. The sandbox remains available only for local testing.

## Work already prepared

- Initial PostgreSQL tables, constraints, indexes, and Row Level Security policies are in `supabase/migrations/202607200001_initial_schema.sql`.
- `.env.example` documents the required Supabase values.
- `_headers` adds baseline browser security headers for Cloudflare Pages.
- `robots.txt` asks search engines not to index private portal pages.
- Runtime data, credentials, Wrangler state, and local logs are excluded from Git.
- The production build uses `matrix-db-production.js`; local JSON and sandbox admin capabilities are not included.
- `npm run sandbox` runs the legacy JSON-backed testing environment locally. `npm run build` creates the Supabase-only Cloudflare artifact.

## Owner actions required

1. Create a Supabase project and save its project URL and publishable key.
2. Install the Supabase CLI, link the project, and apply the migration to a non-production project first.
3. Create the first Auth user for the owner. Insert the matching `profiles` row and grant that user the `admin` role in `user_roles` from the Supabase SQL editor.
4. Choose the member sign-in method: email/password or email OTP. Email/password is recommended if members may not always have immediate email access.
5. Confirm whether members may see the names/statuses of every descendant. Current RLS deliberately does not expose all profiles, so the matrix-tree read contract must be approved before its RPC is written.
6. Confirm the authoritative rules for qualification, approval, withdrawal allocation, rejection, refunds, and record deletion. These will become database transactions and should not be guessed.
7. Provide a sanitized export of legitimate members. Do not migrate `data/matrix-db.json` as production data without reviewing every record.
8. Obtain legal and privacy approval before accepting deposits, investments, or withdrawals.

## Remaining engineering after Supabase is available

1. Add Supabase Auth signup, login, recovery, and logout to the member portal.
2. Replace the browser's `sessionStorage` member/admin flags with Supabase sessions and role checks.
3. Replace synchronous calls in `matrix-db.js` with asynchronous Supabase queries/RPC calls.
4. Implement security-definer RPCs for registration, placement, exit approval, ledger creation, withdrawal reservation/approval, and Products Plus claims.
5. Import reviewed data and reconcile totals.
6. Run authorization tests using member, admin, and anonymous sessions.
7. Deploy to the Cloudflare `pages.dev` preview URL and add the final URL to Supabase Auth redirect settings.
8. Connect the purchased custom domain only after preview acceptance testing.

## Cloudflare Pages settings

- Framework preset: None
- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: the repository's release branch
- Do not upload `data/`, `server.js`, `.env*`, logs, or Supabase service-role credentials.

The browser may receive only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The service-role key must remain in a protected server or Edge Function secret.
