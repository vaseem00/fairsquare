-- REAL_DATA.md section 8: remove the demo, then change the columns for the DLD open data.
-- Generated with drizzle-kit (column changes) and edited by hand: the data clean-up runs first,
-- while the is_demo / is_sample columns still exist.
-- 1. Data clean-up. Deleting a check cascades to its saved listings; deleting a building cascades
--    to its sales and aliases. Sales flagged demo on a real building go too (no fictional sale may stay).
DELETE FROM "leads" WHERE "is_demo";--> statement-breakpoint
DELETE FROM "checks" WHERE "is_demo" OR "is_sample";--> statement-breakpoint
DELETE FROM "buildings" WHERE "is_demo";--> statement-breakpoint
DELETE FROM "sales" WHERE "source" = 'demo' OR "is_demo";--> statement-breakpoint
DELETE FROM "app_meta" WHERE "key" = 'demo_anchor_date';--> statement-breakpoint
-- 2. Drop the demo and sample flags.
ALTER TABLE "buildings" DROP COLUMN "is_demo";--> statement-breakpoint
ALTER TABLE "checks" DROP COLUMN "is_demo";--> statement-breakpoint
ALTER TABLE "checks" DROP COLUMN "is_sample";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN "is_demo";--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "is_demo";--> statement-breakpoint
-- 3. New columns. DLD names repeat across areas, so buildings.name is no longer unique; dld_key is.
ALTER TABLE "buildings" DROP CONSTRAINT "buildings_name_unique";--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "area_dld" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "dld_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_dld_key_uq" ON "buildings" USING btree ("dld_key") WHERE "buildings"."dld_key" is not null;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "completion" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "raw_building_name" text;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_completion_ck" CHECK ("sales"."completion" in ('ready', 'off_plan'));--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "completion_basis" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "outliers_dropped" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "data_through" date;--> statement-breakpoint
-- 4. Sale sources are now open_data | admin | import.
ALTER TABLE "sales" ADD CONSTRAINT "sales_source_ck" CHECK ("sales"."source" in ('open_data', 'admin', 'import'));
