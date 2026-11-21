CREATE TABLE "similar_cells" (
	"building_id" integer NOT NULL,
	"bedrooms" smallint NOT NULL,
	"basis" text NOT NULL,
	"area_dld" text NOT NULL,
	"master_project" text DEFAULT '' NOT NULL,
	"project_number" text DEFAULT '' NOT NULL,
	"n_raw12" integer NOT NULL,
	"n12" integer NOT NULL,
	"med12" double precision,
	"n_old1" integer NOT NULL,
	"med_old1" double precision,
	"n_old2" integer NOT NULL,
	"med_old2" double precision,
	CONSTRAINT "similar_cells_building_id_bedrooms_basis_pk" PRIMARY KEY("building_id","bedrooms","basis")
);
--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "similar_view" jsonb;--> statement-breakpoint
ALTER TABLE "similar_cells" ADD CONSTRAINT "similar_cells_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "similar_cells_area_idx" ON "similar_cells" USING btree ("area_dld","basis");