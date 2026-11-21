CREATE TABLE "admin_sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anon_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ref_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "building_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"building_id" integer NOT NULL,
	"alias_raw" text NOT NULL,
	"alias_norm" text NOT NULL,
	"source" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "building_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"anon_id" uuid,
	"text_raw" text NOT NULL,
	"text_norm" text NOT NULL,
	"area_text" text,
	"source" text NOT NULL,
	"check_id" bigint,
	"resolved_building_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"area" text NOT NULL,
	"project" text,
	"master_project" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "buildings_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"anon_id" uuid NOT NULL,
	"building_id" integer,
	"building_name" text,
	"building_area" text,
	"building_text" text NOT NULL,
	"area_text" text,
	"bedrooms" smallint NOT NULL,
	"size_sqft" double precision NOT NULL,
	"price_aed" bigint NOT NULL,
	"property_type" text DEFAULT 'unknown' NOT NULL,
	"completion" text DEFAULT 'unknown' NOT NULL,
	"source" text NOT NULL,
	"edited_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"band" text NOT NULL,
	"asking_psf" double precision NOT NULL,
	"median_psf" double precision,
	"median_price_aed" double precision,
	"sales_count" integer DEFAULT 0 NOT NULL,
	"diff" double precision,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"min_sales" smallint NOT NULL,
	"band_pct" real NOT NULL,
	"sales_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_demo" boolean NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"ref_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checks_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"anon_id" uuid,
	"check_id" bigint,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"anon_id" uuid,
	"check_id" bigint,
	"partner" text NOT NULL,
	"consent_version" text NOT NULL,
	"consent_text" text NOT NULL,
	"consent_text_sha256" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"name" text,
	"phone_e164" text,
	"phone_last4" text,
	"ip_hash" text NOT NULL,
	"building_name" text NOT NULL,
	"bedrooms" smallint NOT NULL,
	"size_sqft" double precision NOT NULL,
	"price_aed" bigint NOT NULL,
	"down_pct" smallint NOT NULL,
	"rate_pct" real NOT NULL,
	"years" smallint NOT NULL,
	"loan_estimate_aed" integer NOT NULL,
	"monthly_estimate_aed" integer NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"sent_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"withdrawal_notified_at" timestamp with time zone,
	"is_demo" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"building_id" integer NOT NULL,
	"sale_date" date NOT NULL,
	"bedrooms" smallint NOT NULL,
	"size_sqft" double precision NOT NULL,
	"price_aed" bigint NOT NULL,
	"source" text NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"external_ref" text,
	"import_batch" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_external_ref_unique" UNIQUE("external_ref"),
	CONSTRAINT "sales_bedrooms_ck" CHECK ("sales"."bedrooms" between 0 and 7),
	CONSTRAINT "sales_positive_ck" CHECK ("sales"."size_sqft" > 0 and "sales"."price_aed" > 0)
);
--> statement-breakpoint
CREATE TABLE "saved_listings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"anon_id" uuid NOT NULL,
	"check_id" bigint NOT NULL,
	"band_at_save" text NOT NULL,
	"diff_at_save" double precision,
	"count_at_save" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "building_aliases" ADD CONSTRAINT "building_aliases_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_requests" ADD CONSTRAINT "building_requests_anon_id_anon_users_id_fk" FOREIGN KEY ("anon_id") REFERENCES "public"."anon_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_requests" ADD CONSTRAINT "building_requests_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "building_requests" ADD CONSTRAINT "building_requests_resolved_building_id_buildings_id_fk" FOREIGN KEY ("resolved_building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_anon_id_anon_users_id_fk" FOREIGN KEY ("anon_id") REFERENCES "public"."anon_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_anon_id_anon_users_id_fk" FOREIGN KEY ("anon_id") REFERENCES "public"."anon_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_anon_id_anon_users_id_fk" FOREIGN KEY ("anon_id") REFERENCES "public"."anon_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_building_id_buildings_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."buildings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_anon_id_anon_users_id_fk" FOREIGN KEY ("anon_id") REFERENCES "public"."anon_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_listings" ADD CONSTRAINT "saved_listings_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "building_aliases_norm_building_uq" ON "building_aliases" USING btree ("alias_norm","building_id");--> statement-breakpoint
CREATE INDEX "building_aliases_norm_idx" ON "building_aliases" USING btree ("alias_norm");--> statement-breakpoint
CREATE INDEX "requests_norm_idx" ON "building_requests" USING btree ("text_norm");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_anon_norm_uq" ON "building_requests" USING btree ("anon_id","text_norm") WHERE "building_requests"."anon_id" is not null;--> statement-breakpoint
CREATE INDEX "checks_created_idx" ON "checks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "checks_anon_idx" ON "checks" USING btree ("anon_id");--> statement-breakpoint
CREATE INDEX "checks_building_idx" ON "checks" USING btree ("building_id","bedrooms");--> statement-breakpoint
CREATE INDEX "events_name_created_idx" ON "events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "leads_anon_idx" ON "leads" USING btree ("anon_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_active_uq" ON "leads" USING btree ("anon_id","check_id") WHERE "leads"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sales_lookup_idx" ON "sales" USING btree ("building_id","bedrooms","sale_date");--> statement-breakpoint
CREATE INDEX "sales_recorded_idx" ON "sales" USING btree ("building_id","bedrooms","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_anon_check_uq" ON "saved_listings" USING btree ("anon_id","check_id");