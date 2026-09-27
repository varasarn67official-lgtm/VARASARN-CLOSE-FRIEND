ALTER TABLE app_private.reviews ALTER COLUMN author_user_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD COLUMN is_legacy boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE UNIQUE INDEX reviews_legacy_offering_text_unique ON app_private.reviews(offering_id,text) WHERE is_legacy;
--> statement-breakpoint
DROP FUNCTION api.list_visible_reviews(uuid,integer,text,integer);
--> statement-breakpoint
CREATE FUNCTION api.list_visible_reviews(p_offering_id uuid DEFAULT NULL,p_rating integer DEFAULT NULL,p_semester text DEFAULT NULL,p_academic_year integer DEFAULT NULL) RETURNS TABLE(id uuid,rating integer,text text,created_at timestamptz,section text,semester text,academic_year integer,instructor_name text) LANGUAGE sql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ SELECT r.id,r.rating,r.text,r.created_at,o.section,o.semester,o.academic_year,o.instructor_name FROM reviews r JOIN offerings o ON o.id=r.offering_id WHERE r.author_active AND r.moderation_visible AND (o.status='approved' OR r.is_legacy) AND (p_offering_id IS NULL OR o.id=p_offering_id) AND (p_rating IS NULL OR r.rating=p_rating) AND (p_semester IS NULL OR o.semester=p_semester) AND (p_academic_year IS NULL OR o.academic_year=p_academic_year) ORDER BY r.created_at DESC $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_visible_reviews(uuid,integer,text,integer) TO authenticated;
