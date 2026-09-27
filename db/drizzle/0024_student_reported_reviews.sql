-- Student reviews describe an experience. Official offerings remain the timetable source.
ALTER TABLE app_private.reviews ADD COLUMN course_id uuid REFERENCES app_private.courses(id);
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD COLUMN academic_year integer;
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD COLUMN semester text;
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD COLUMN section text;
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD COLUMN instructor_name text;
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD COLUMN day_of_week integer;
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD COLUMN starts_at time;
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD COLUMN ends_at time;
--> statement-breakpoint
UPDATE app_private.reviews r SET
  course_id=o.course_id, academic_year=o.academic_year, semester=o.semester,
  section=o.section, instructor_name=o.instructor_name
FROM app_private.offerings o WHERE o.id=r.offering_id;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM app_private.reviews WHERE course_id IS NULL OR academic_year IS NULL OR semester IS NULL OR section IS NULL) THEN
    RAISE EXCEPTION 'review context backfill incomplete';
  END IF;
  IF EXISTS(
    SELECT 1 FROM app_private.reviews WHERE author_user_id IS NOT NULL
    GROUP BY author_user_id,course_id,academic_year,semester,
      lower(regexp_replace(btrim(section),'[[:space:]]+','','g'))
    HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'existing reviews conflict on normalized class context'; END IF;
END $$;
--> statement-breakpoint
ALTER TABLE app_private.reviews ALTER COLUMN course_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE app_private.reviews ALTER COLUMN academic_year SET NOT NULL;
--> statement-breakpoint
ALTER TABLE app_private.reviews ALTER COLUMN semester SET NOT NULL;
--> statement-breakpoint
ALTER TABLE app_private.reviews ALTER COLUMN section SET NOT NULL;
--> statement-breakpoint
ALTER TABLE app_private.reviews ALTER COLUMN offering_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD CONSTRAINT reviews_reported_year_check CHECK(academic_year BETWEEN 2400 AND 2700);
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD CONSTRAINT reviews_reported_semester_check CHECK(semester IN ('1','2','ฤดูร้อน'));
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD CONSTRAINT reviews_reported_section_check CHECK(length(btrim(section))>0);
--> statement-breakpoint
ALTER TABLE app_private.reviews ADD CONSTRAINT reviews_reported_time_check CHECK(
  (day_of_week IS NULL AND starts_at IS NULL AND ends_at IS NULL)
  OR (day_of_week BETWEEN 1 AND 7 AND starts_at IS NOT NULL AND ends_at>starts_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX reviews_author_course_class_unique ON app_private.reviews(
  author_user_id,course_id,academic_year,semester,
  lower(regexp_replace(btrim(section),'[[:space:]]+','','g'))
) WHERE author_user_id IS NOT NULL;
--> statement-breakpoint
DROP FUNCTION api.create_review(uuid,integer,text);
--> statement-breakpoint
CREATE FUNCTION api.create_review(
  p_course_id uuid,p_academic_year integer,p_semester text,p_section text,
  p_instructor_name text,p_day integer,p_starts time,p_ends time,
  p_rating integer,p_text text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.user_id() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM courses WHERE id=p_course_id AND status='approved') THEN RAISE EXCEPTION 'approved course required'; END IF;
  IF p_academic_year NOT BETWEEN 2400 AND 2700 OR p_semester NOT IN ('1','2','ฤดูร้อน')
    OR length(btrim(coalesce(p_section,'')))=0
    OR length(btrim(coalesce(p_instructor_name,'')))=0
    OR p_day NOT BETWEEN 1 AND 7 OR p_starts IS NULL OR p_ends<=p_starts
    OR p_rating NOT BETWEEN 1 AND 5 OR length(btrim(coalesce(p_text,'')))=0
  THEN RAISE EXCEPTION 'invalid review or class details'; END IF;
  INSERT INTO reviews(author_user_id,course_id,academic_year,semester,section,
    instructor_name,day_of_week,starts_at,ends_at,rating,text)
  VALUES(auth.user_id(),p_course_id,p_academic_year,p_semester,btrim(p_section),
    btrim(p_instructor_name),p_day,p_starts,p_ends,p_rating,btrim(p_text))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_review(uuid,integer,text,text,text,integer,time,time,integer,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_review(uuid,integer,text,text,text,integer,time,time,integer,text) TO authenticated;
--> statement-breakpoint
DROP FUNCTION api.list_visible_reviews(uuid,integer,text,integer);
--> statement-breakpoint
CREATE FUNCTION api.list_visible_reviews(
  p_course_id uuid,p_rating integer DEFAULT NULL,p_semester text DEFAULT NULL,p_academic_year integer DEFAULT NULL
) RETURNS TABLE(id uuid,rating integer,text text,created_at timestamptz,
  section text,semester text,academic_year integer,instructor_name text,
  day_of_week integer,starts_at time,ends_at time)
LANGUAGE sql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
  SELECT r.id,r.rating,r.text,r.created_at,r.section,r.semester,r.academic_year,
    r.instructor_name,r.day_of_week,r.starts_at,r.ends_at
  FROM reviews r WHERE r.course_id=p_course_id AND r.author_active AND r.moderation_visible
    AND (p_rating IS NULL OR r.rating=p_rating)
    AND (p_semester IS NULL OR r.semester=p_semester)
    AND (p_academic_year IS NULL OR r.academic_year=p_academic_year)
  ORDER BY r.created_at DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_visible_reviews(uuid,integer,text,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_visible_reviews(uuid,integer,text,integer) TO authenticated;
--> statement-breakpoint
DROP FUNCTION api.list_my_reviews();
--> statement-breakpoint
CREATE FUNCTION api.list_my_reviews() RETURNS TABLE(
  id uuid,course_id uuid,offering_id uuid,rating integer,text text,
  author_active boolean,created_at timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
  SELECT r.id,r.course_id,r.offering_id,r.rating,r.text,r.author_active,r.created_at
  FROM reviews r WHERE r.author_user_id=auth.user_id() ORDER BY r.created_at DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_my_reviews() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_my_reviews() TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.preview_course_merge(p_source_course_id uuid,p_target_course_id uuid)
RETURNS TABLE(source_code text,target_code text,offerings_to_move bigint,reviews_preserved bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
BEGIN
  PERFORM app_private.require_administrator();
  IF p_source_course_id=p_target_course_id THEN RAISE EXCEPTION 'source and target must differ'; END IF;
  IF NOT EXISTS(SELECT 1 FROM courses WHERE id=p_source_course_id)
    OR NOT EXISTS(SELECT 1 FROM courses WHERE id=p_target_course_id) THEN RAISE EXCEPTION 'course not found'; END IF;
  IF EXISTS(
    SELECT 1 FROM offerings s JOIN offerings t ON t.course_id=p_target_course_id
      AND s.course_id=p_source_course_id AND t.academic_year=s.academic_year
      AND t.semester=s.semester AND t.section=s.section
  ) THEN RAISE EXCEPTION 'offering conflict prevents merge'; END IF;
  IF EXISTS(
    SELECT 1 FROM reviews s JOIN reviews t
      ON s.author_user_id=t.author_user_id AND t.course_id=p_target_course_id
      AND s.course_id=p_source_course_id AND s.academic_year=t.academic_year
      AND s.semester=t.semester
      AND lower(regexp_replace(btrim(s.section),'[[:space:]]+','','g'))=
          lower(regexp_replace(btrim(t.section),'[[:space:]]+','','g'))
    WHERE s.author_user_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'review conflict prevents merge'; END IF;
  RETURN QUERY SELECT s.code,t.code,
    (SELECT count(*) FROM offerings WHERE course_id=s.id),
    (SELECT count(*) FROM reviews WHERE course_id=s.id)
  FROM courses s,courses t WHERE s.id=p_source_course_id AND t.id=p_target_course_id;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.merge_course(p_source_course_id uuid,p_target_course_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
BEGIN
  PERFORM * FROM api.preview_course_merge(p_source_course_id,p_target_course_id);
  UPDATE reviews SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  UPDATE offerings SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  UPDATE courses SET status='archived' WHERE id=p_source_course_id;
  INSERT INTO course_merge_audit(actor_user_id,source_course_id,target_course_id)
  VALUES(auth.user_id()::uuid,p_source_course_id,p_target_course_id);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.import_legacy_reviews(p_rows jsonb)
RETURNS TABLE(imported_count integer,duplicate_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE r jsonb; v_course uuid; v_offering uuid; v_year integer; v_semester text;
  v_section text; v_imported integer := 0; v_duplicates integer := 0;
BEGIN
  PERFORM app_private.require_owner();
  IF jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'rows must be an array'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    SELECT id INTO v_course FROM courses
      WHERE code=upper(regexp_replace(btrim(r->>'courseCode'),'[[:space:]]+','','g'));
    v_year := CASE WHEN (r->>'year') ~ '^[0-9]+$' THEN (r->>'year')::integer ELSE NULL END;
    v_semester := btrim(r->>'semester'); v_section := btrim(r->>'section');
    IF v_course IS NULL OR (r->>'rating') !~ '^[1-5]$'
      OR length(btrim(coalesce(r->>'text','')))=0 OR v_year NOT BETWEEN 2400 AND 2700
      OR v_semester NOT IN ('1','2','ฤดูร้อน') OR length(v_section)=0
    THEN RAISE EXCEPTION 'invalid or unmatched legacy row'; END IF;
    INSERT INTO offerings(course_id,academic_year,semester,section,instructor_name,status)
    VALUES(v_course,v_year,v_semester,v_section,nullif(btrim(r->>'instructorName'),''),'rejected')
    ON CONFLICT(course_id,academic_year,semester,section) DO NOTHING;
    SELECT id INTO v_offering FROM offerings
      WHERE course_id=v_course AND academic_year=v_year AND semester=v_semester AND section=v_section;
    IF EXISTS(SELECT 1 FROM reviews
      WHERE offering_id=v_offering AND text=btrim(r->>'text') AND is_legacy)
    THEN v_duplicates := v_duplicates+1;
    ELSE
      INSERT INTO reviews(author_user_id,course_id,offering_id,academic_year,semester,
        section,instructor_name,rating,text,created_at,is_legacy)
      VALUES(NULL,v_course,v_offering,v_year,v_semester,v_section,
        nullif(btrim(r->>'instructorName'),''),(r->>'rating')::integer,
        btrim(r->>'text'),COALESCE(NULLIF(r->>'createdAt','')::timestamptz,now()),true);
      v_imported := v_imported+1;
    END IF;
  END LOOP;
  INSERT INTO legacy_import_audit(actor_user_id,source_rows,imported_count,duplicate_count)
  VALUES(auth.user_id()::uuid,jsonb_array_length(p_rows),v_imported,v_duplicates);
  RETURN QUERY SELECT v_imported,v_duplicates;
END $$;
