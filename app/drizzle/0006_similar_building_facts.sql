ALTER TABLE "buildings" ADD COLUMN "project_number" integer;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "nearest_metro" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "nearest_mall" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "nearest_landmark" text;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "first_sale_date" date;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "first_ready_sale_date" date;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "last_sale_date" date;--> statement-breakpoint
ALTER TABLE "buildings" ADD COLUMN "off_plan_share" real;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "has_parking" boolean;