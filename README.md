# Matrix Website

Responsive Matrix Consumer Services website prototype with:

- Public landing page
- Member registration and dashboard
- Admin approval and matrix placement panel
- Local Node API and file-backed JSON database for prototype development
- Supabase production schema foundation with Row Level Security
- Cloudflare Pages static-build and security-header configuration

## Run

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

If port `3000` is already in use, run with another port:

```powershell
$env:PORT = "3100"
npm start
```

The portal and admin pages must be opened through the local server so they can call the Matrix API. Opening the HTML files directly will not load server-backed data.

## Local sandbox

The JSON database, seeded members, import/reset controls, and prototype admin panel are restricted to local sandbox mode:

```bash
npm run sandbox
```

Sandbox-only routes are never copied into the production `dist/` build.

## Admin

Default demo password:

```text
admin123
```

The admin panel can seed sample data, approve pending registrations, place members in a matrix tree, export/import data, and reset the local database.

## Data Storage

The local API stores records in:

```text
data/matrix-db.json
```

That file is generated at runtime and ignored by Git.

## Production tracking release

The static production build uses Supabase Auth, PostgreSQL transactions, Row Level Security, member/admin sessions, Owner-only finances, administrator invitations, Products Plus claims, non-expiring vouchers, and partial voucher redemptions. Payment verification, placement, approvals, GCash payouts, and voucher fulfillment remain intentionally manual for the local-business phase.

The production database is linked to Supabase project `rvylugnfclguwhdvxprn`. All migrations through `202607220004` are applied. James is the original Owner; invited administrators can process requests but cannot access Owner finances or review their own requests.

Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the Cloudflare Pages settings and launch checks.

## Static deployment package

```bash
npm run build
```

This creates a clean Supabase-only `dist/` folder containing allowlisted public assets. It excludes the local JSON adapter, sandbox configuration, local database, Node server, SQL migrations, logs, and documentation.

## Validation

```bash
npm run check
npm run check:supabase
```

This checks the Node server and every browser JavaScript file for syntax errors.
