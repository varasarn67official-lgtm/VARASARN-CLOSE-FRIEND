CREATE TABLE app_private.offering_import_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid NOT NULL REFERENCES neon_auth."user"(id), source_rows integer NOT NULL, created_count integer NOT NULL, existing_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
ALTER TABLE app_private.offering_import_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION api.bulk_import_offerings(p_rows jsonb)
RETURNS TABLE(created_count integer, existing_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private, pg_temp
AS $$ DECLARE r jsonb; v_course uuid; v_created integer := 0; v_existing integer := 0; BEGIN
  PERFORM app_private.require_administrator();
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN RAISE EXCEPTION 'one or more rows required'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    SELECT id INTO v_course FROM courses WHERE code=upper(regexp_replace(btrim(r->>'courseCode'),'\s+','','g')) AND status='approved';
    IF v_course IS NULL OR (r->>'academicYear') !~ '^\d+$' OR btrim(r->>'semester')='' OR btrim(r->>'section')='' OR (r->>'dayOfWeek') !~ '^[1-7]$' OR (r->>'startsAt') !~ '^\d\d:\d\d$' OR (r->>'endsAt') !~ '^\d\d:\d\d$' OR (r->>'endsAt')::time <= (r->>'startsAt')::time THEN RAISE EXCEPTION 'invalid or unknown offering row'; END IF;
    IF EXISTS(SELECT 1 FROM offerings WHERE course_id=v_course AND academic_year=(r->>'academicYear')::integer AND semester=btrim(r->>'semester') AND section=btrim(r->>'section')) THEN v_existing := v_existing + 1; ELSE
      INSERT INTO offerings(course_id,academic_year,semester,section,instructor_name,status) VALUES(v_course,(r->>'academicYear')::integer,btrim(r->>'semester'),btrim(r->>'section'),nullif(btrim(r->>'instructorName'),''),'approved');
      INSERT INTO offering_meetings(offering_id,day_of_week,starts_at,ends_at) SELECT id,(r->>'dayOfWeek')::integer,(r->>'startsAt')::time,(r->>'endsAt')::time FROM offerings WHERE course_id=v_course AND academic_year=(r->>'academicYear')::integer AND semester=btrim(r->>'semester') AND section=btrim(r->>'section'); v_created := v_created + 1;
    END IF;
  END LOOP;
  INSERT INTO offering_import_audit(actor_user_id,source_rows,created_count,existing_count) VALUES(auth.user_id()::uuid,jsonb_array_length(p_rows),v_created,v_existing);
  RETURN QUERY SELECT v_created,v_existing;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.bulk_import_offerings(jsonb) TO authenticated;
