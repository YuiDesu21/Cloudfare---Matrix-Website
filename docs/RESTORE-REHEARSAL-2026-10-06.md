# Local database restore rehearsal (October 6, 2026)

- Source: ignored live database archive `data/backups/live-rvylugnfclguwhdvxprn-20261006-001614.backup` (3,272,113 bytes; SHA-256 `CCE138EC7604C51879CA6E610F2B225FA014110B0F4218D3D0E781D538CA49F3`).
- Archive: PostgreSQL custom format, 781 TOC entries, dumped from PostgreSQL 17.6 with `pg_dump` 17.11.
- Target: separate Supabase PostgreSQL 17.6 Docker volume on D:, launched in a container with `--network none` and no published ports. Neither hosted Supabase project was used as a restore target.
- Method: create a separate empty database, then run `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges` as the local `supabase_admin` role. The command completed with exit code 0. A first attempt as local `postgres` failed on a privileged function setting and rolled back completely.
- Validation: 28 public tables; 6 Auth users; 6 profiles; 4 matrix positions; 18 reward rows; 52 migrations, latest `202609090002`; zero orphan profiles and zero unvalidated public constraints. The snapshot contained zero Storage buckets and zero Storage objects.
- The CLI's `db start --from-backup` shortcut did not initialize this custom `PGDMP` archive correctly and must not be treated as a successful restore. The explicit `pg_restore` method above is the verified path.
- After validation, the temporary D: archive copy, both rehearsal containers, and the rehearsal database volume were removed. The original ignored archive retained the same SHA-256 hash. Docker Desktop remains installed on D: for future local testing.

This verifies the October 6 database archive only. It does not validate current live data, Supabase Storage files, Auth email delivery, or the application workflow after restoration. Take and verify a fresh backup immediately before any live migration.
