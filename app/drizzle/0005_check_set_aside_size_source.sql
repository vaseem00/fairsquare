-- RESULT_SPEC section 12.2: a stored comparison keeps the unusual sales it left out, so the sales list
-- can show them marked "set aside" (comparisons stored before this keep an empty list), and where the
-- size came from ("read", "typed" or "cluster", a size button shown as "about 815 sq ft"; null before).
ALTER TABLE "checks" ADD COLUMN "set_aside_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "size_source" text;
