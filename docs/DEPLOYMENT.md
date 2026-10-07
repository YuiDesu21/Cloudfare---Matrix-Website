# Supabase and Cloudflare deployment handoff

## Current status (October 8, 2026)

- See `docs/RELEASE-READINESS-2026-10-07.md` for the release checks and post-deployment monitoring. The 23 reviewed migrations and commit `5ce7e16` were deployed live on October 8; the owner confirmed member/admin sign-in and unchanged balances.
- A fresh October 8 live archive was verified and restored into an isolated no-network database before cutover. All 23 pending migrations and five rollback-only smoke tests passed against that copy. The live database now has 75 migrations through `202610070003`; the source checkout remains linked to staging.
- The Patronizing package checkout, shipping review, fictional payment submission, and Owner rejection were rehearsed in staging. All exact-match QA records were removed with no payment credited.
- Signed-in staging pilots covered Budget, Patronizing, Standard, and Premium placements; an approved monthly product purchase and income unlock; Exit 1 discounted checkout and its post-discount monthly credit; Main Funds transfers; a matured Budget investment contract and capital return; withdrawal rejection and approval; and Owner review of fictional payments and top-ups. All disposable fixtures were removed, and the owner accepted the pilot before cutover. No real payment or payout was made. The owner accepted the Supabase Free-plan leaked-password warning. F3 network-specific handling and independent legal review remain deferred; do not interpret technical readiness as authorization for public financial enrollment.

## Earlier status (October 6, 2026)

- This checkout is linked to staging project `sssfvmyukpmzbktdlybg`, not live.
- Staging has migrations through `202610060006`; live project `rvylugnfclguwhdvxprn` stops at `202609090002`. Do not run a live migration from the staging link.
- The 693 Timeline investment schedule remains in `docs/TIMELINE-INVESTMENT-DRAFT.sql` and is not a deployable migration.
- The October 6 live database archive was restored successfully into an offline local Supabase PostgreSQL 17 database; see `docs/RESTORE-REHEARSAL-2026-10-06.md`. The snapshot had no Storage buckets or objects, but current live Storage must be checked again before deployment. Supabase Storage files are not included in database archives.
- Staging rollback-only funds, payment-review, and four-tier Patronizing smoke tests pass. The clean-room pilot, JavaScript checks, static build, and error-level staging security advisor pass. The four Patronizing entry cards, 12-token dialog, and package empty state were checked at desktop, tablet, and phone widths. Staging has no active Timeline packages, so a populated package checkout and real signed-in payment approval remain unverified. Other placed matrices and nonzero balances still need acceptance testing.
- Staging has additional Admin and Owner roles on the existing Junel account for UI testing only. The live project was not changed.
- See `docs/AUDIT-2026-10-06.md` for the verified fixes and remaining launch concerns.
- Before live rollout: confirm the investment terms and required legal authority, check current Storage and back up any files, complete signed-in member/admin acceptance testing, and take a fresh backup immediately before applying migrations.

## Historical status (July 22, 2026)

- Supabase project `rvylugnfclguwhdvxprn` was linked and healthy at that time.
- Local and remote migration history match through `202607220004`.
- James is verified as the original Owner and administrator.
- Supabase Auth is reachable and public signup is enabled.
- `npm run check`, `npm run check:supabase`, and `npm run build` pass.
- Cloudflare Pages is deployed at `https://matrix-consumer-services.pages.dev` from the `main` branch.
- Supabase Site URL and the `/portal.html` redirect allow-list entry use the production Pages URL.

The repository contains the production Supabase database, browser adapter, Cloudflare security headers, and a clean static build. The sandbox remains available only for local testing.

## Work already prepared

- Initial PostgreSQL tables, constraints, indexes, and Row Level Security policies are in `supabase/migrations/202607200001_initial_schema.sql`.
- `.env.example` documents the required Supabase values.
- `_headers` adds baseline browser security headers for Cloudflare Pages.
- `robots.txt` asks search engines not to index private portal pages.
- Runtime data, credentials, Wrangler state, and local logs are excluded from Git.
- The production build uses `matrix-db-production.js`; local JSON and sandbox admin capabilities are not included.
- `npm run sandbox` runs the legacy JSON-backed testing environment locally. `npm run build` creates the Supabase-only Cloudflare artifact.

## Historical setup checklist

1. Create a Supabase project and save its project URL and publishable key.
2. Install the Supabase CLI, link the project, and apply the migration to a non-production project first.
3. Create the first Auth user for the owner. Insert the matching `profiles` row and grant that user the `admin` role in `user_roles` from the Supabase SQL editor.
4. Choose the member sign-in method: email/password or email OTP. Email/password is recommended if members may not always have immediate email access.
5. Confirm whether members may see the names/statuses of every descendant. Current RLS deliberately does not expose all profiles, so the matrix-tree read contract must be approved before its RPC is written.
6. Confirm the authoritative rules for qualification, approval, withdrawal allocation, rejection, refunds, and record deletion. These will become database transactions and should not be guessed.
7. Provide a sanitized export of legitimate members. Do not migrate `data/matrix-db.json` as production data without reviewing every record.
8. Obtain legal and privacy approval before accepting deposits, investments, or withdrawals.

## Historical implementation checklist

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
