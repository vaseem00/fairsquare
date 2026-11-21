CREATE TABLE "deleted_anon_ids" (
	"id" uuid PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
