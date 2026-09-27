CREATE SCHEMA "app_private";
--> statement-breakpoint
CREATE TABLE "app_private"."courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_th" text NOT NULL,
	"category_name" text NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	CONSTRAINT "courses_code_unique" UNIQUE("code"),
	CONSTRAINT "courses_status_check" CHECK ("app_private"."courses"."status" in ('approved', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "app_private"."offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"academic_year" integer NOT NULL,
	"semester" text NOT NULL,
	"section" text NOT NULL,
	"instructor_name" text,
	"status" text DEFAULT 'approved' NOT NULL,
	CONSTRAINT "offerings_course_period_section_unique" UNIQUE("course_id","academic_year","semester","section"),
	CONSTRAINT "offerings_status_check" CHECK ("app_private"."offerings"."status" in ('approved', 'pending', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "app_private"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_user_id" text NOT NULL,
	"offering_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"text" text NOT NULL,
	"author_active" boolean DEFAULT true NOT NULL,
	"moderation_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_author_offering_unique" UNIQUE("author_user_id","offering_id"),
	CONSTRAINT "reviews_rating_check" CHECK ("app_private"."reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_text_check" CHECK (length(btrim("app_private"."reviews"."text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "app_private"."offerings" ADD CONSTRAINT "offerings_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "app_private"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_private"."reviews" ADD CONSTRAINT "reviews_offering_id_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "app_private"."offerings"("id") ON DELETE no action ON UPDATE no action;