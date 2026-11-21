-- REAL_DATA.md section 6: a stored comparison keeps the official DLD area of its building next to the
-- display area, so the result and /c pages can show "Dubai Marina (DLD area: Marsa Dubai)".
ALTER TABLE "checks" ADD COLUMN "building_area_dld" text;--> statement-breakpoint
-- Comparisons made before this column existed take it from their building, when it is still there.
UPDATE "checks" SET "building_area_dld" = "buildings"."area_dld" FROM "buildings" WHERE "buildings"."id" = "checks"."building_id" AND "buildings"."area_dld" IS NOT NULL;
