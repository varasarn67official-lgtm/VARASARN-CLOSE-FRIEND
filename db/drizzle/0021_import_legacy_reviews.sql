CREATE TABLE app_private.legacy_import_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid NOT NULL REFERENCES neon_auth."user"(id), source_rows integer NOT NULL, imported_count integer NOT NULL, duplicate_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
ALTER TABLE app_private.legacy_import_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION api.import_legacy_reviews(p_rows jsonb)
RETURNS TABLE(imported_count integer, duplicate_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ DECLARE r jsonb; v_course uuid; v_offering uuid; v_imported integer := 0; v_duplicates integer := 0; BEGIN
  PERFORM app_private.require_owner();
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'rows must be an array'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    SELECT id INTO v_course FROM courses WHERE code=upper(regexp_replace(btrim(r->>'courseCode'),'\s+','','g'));
    IF v_course IS NULL OR (r->>'rating') !~ '^[1-5]$' OR length(btrim(r->>'text'))=0 OR (r->>'year') !~ '^\d+$' OR length(btrim(r->>'semester'))=0 OR length(btrim(r->>'section'))=0 THEN RAISE EXCEPTION 'invalid or unmatched legacy row'; END IF;
    INSERT INTO offerings(course_id,academic_year,semester,section,instructor_name,status) VALUES(v_course,(r->>'year')::integer,btrim(r->>'semester'),btrim(r->>'section'),nullif(btrim(r->>'instructorName'),''),'rejected') ON CONFLICT(course_id,academic_year,semester,section) DO NOTHING;
    SELECT id INTO v_offering FROM offerings WHERE course_id=v_course AND academic_year=(r->>'year')::integer AND semester=btrim(r->>'semester') AND section=btrim(r->>'section');
    IF EXISTS(SELECT 1 FROM reviews WHERE offering_id=v_offering AND text=btrim(r->>'text') AND is_legacy) THEN v_duplicates := v_duplicates + 1; ELSE INSERT INTO reviews(author_user_id,offering_id,rating,text,created_at,is_legacy) VALUES(NULL,v_offering,(r->>'rating')::integer,btrim(r->>'text'),COALESCE(NULLIF(r->>'createdAt','')::timestamptz,now()),true); v_imported := v_imported + 1; END IF;
  END LOOP;
  INSERT INTO legacy_import_audit(actor_user_id,source_rows,imported_count,duplicate_count) VALUES(auth.user_id()::uuid,jsonb_array_length(p_rows),v_imported,v_duplicates);
  RETURN QUERY SELECT v_imported,v_duplicates;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.import_legacy_reviews(jsonb) TO authenticated;
