-- Custom SQL migration file, put your code below! --
CREATE SCHEMA "api";
--> statement-breakpoint
REVOKE ALL ON SCHEMA public, app_private, api FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA api TO authenticated;
--> statement-breakpoint
ALTER TABLE app_private.courses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app_private.offerings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app_private.reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION api.list_approved_catalog()
RETURNS TABLE(id uuid, code text, name_th text, category_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$ SELECT id, code, name_th, category_name FROM courses WHERE status = 'approved' ORDER BY code $$;
--> statement-breakpoint
CREATE FUNCTION api.list_approved_offerings(p_course_id uuid)
RETURNS TABLE(id uuid, section text, academic_year integer, semester text, instructor_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$ SELECT id, section, academic_year, semester, instructor_name FROM offerings WHERE course_id = p_course_id AND status = 'approved' ORDER BY academic_year DESC, semester, section $$;
--> statement-breakpoint
CREATE FUNCTION api.list_visible_reviews(p_offering_id uuid)
RETURNS TABLE(id uuid, rating integer, text text, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$ SELECT id, rating, text, created_at FROM reviews WHERE offering_id = p_offering_id AND author_active AND moderation_visible ORDER BY created_at DESC $$;
--> statement-breakpoint
CREATE FUNCTION api.create_review(p_offering_id uuid, p_rating integer, p_text text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
BEGIN
  IF auth.user_id() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM offerings WHERE id = p_offering_id AND status = 'approved') THEN RAISE EXCEPTION 'offering is unavailable'; END IF;
  IF p_rating NOT BETWEEN 1 AND 5 OR length(btrim(p_text)) = 0 THEN RAISE EXCEPTION 'invalid review'; END IF;
  IF EXISTS (SELECT 1 FROM reviews WHERE author_user_id = auth.user_id() AND offering_id = p_offering_id) THEN RAISE EXCEPTION 'a review already exists for this offering'; END IF;
  INSERT INTO reviews(author_user_id, offering_id, rating, text) VALUES(auth.user_id(), p_offering_id, p_rating, btrim(p_text));
END $$;
--> statement-breakpoint
INSERT INTO app_private.courses(code, name_th, category_name)
VALUES ('JC100', 'ความรู้เบื้องต้นทางวารสารศาสตร์', 'วิชาแกนคณะ');
--> statement-breakpoint
INSERT INTO app_private.offerings(course_id, academic_year, semester, section, instructor_name)
SELECT id, 2569, '1', '1', 'อาจารย์ผู้สอน' FROM app_private.courses WHERE code = 'JC100';
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA app_private REVOKE ALL ON TABLES FROM PUBLIC, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA api REVOKE ALL ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO authenticated;
