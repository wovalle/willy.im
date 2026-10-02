-- One-off: re-key wrangler's applied-migration log for the drizzle-kit v1 folder layout.
--
-- `drizzle-kit up` moved drizzle/NNNN_name.sql to drizzle/<timestamp>_name/migration.sql
-- (byte-identical SQL), and wrangler.jsonc now reads `drizzle/*/migration.sql`.
-- Wrangler identifies applied migrations by that path, so without this rename it
-- would re-run 0000–0003 against the production database and fail on CREATE TABLE.
--
-- NOT applied automatically. Run once against production, BEFORE
-- `npm run db:migrate-prod`, from apps/idp:
--
--   npx wrangler d1 execute db --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"
--     -> expect exactly the 4 old names below
--   npx wrangler d1 execute db --remote --file scripts/d1-migrations-rename-v1.sql
--   npx wrangler d1 execute db --remote --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"
--     -> expect the 4 new names, same ids and applied_at
--   npx wrangler d1 migrations list db --remote
--     -> expect only the new migrations (20261002…) as unapplied
--
-- Each UPDATE matches the old name exactly, so a second run is a no-op.

UPDATE d1_migrations SET name = '20260813200726_third_master_chief/migration.sql' WHERE name = '0000_third_master_chief.sql';
UPDATE d1_migrations SET name = '20260821155647_smart_deadpool/migration.sql'     WHERE name = '0001_smart_deadpool.sql';
UPDATE d1_migrations SET name = '20260822211811_certain_vampiro/migration.sql'    WHERE name = '0002_certain_vampiro.sql';
UPDATE d1_migrations SET name = '20260925010237_special_gravity/migration.sql'    WHERE name = '0003_special_gravity.sql';

SELECT id, name, applied_at FROM d1_migrations ORDER BY id;
