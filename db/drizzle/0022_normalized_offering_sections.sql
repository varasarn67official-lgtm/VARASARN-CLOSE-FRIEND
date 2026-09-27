CREATE UNIQUE INDEX offerings_normalized_section_unique
ON app_private.offerings (course_id, academic_year, semester, lower(btrim(section)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_offering(p_course_id uuid,p_academic_year integer,p_semester text,p_section text,p_instructor_name text,p_day integer,p_starts time,p_ends time)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ DECLARE v_id uuid; DECLARE v_section text := btrim(p_section); BEGIN
  PERFORM app_private.require_administrator();
  IF NOT EXISTS(SELECT 1 FROM courses WHERE id=p_course_id AND status='approved') THEN RAISE EXCEPTION 'active course required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM academic_periods WHERE academic_year=p_academic_year AND semester=btrim(p_semester)) THEN RAISE EXCEPTION 'academic period required'; END IF;
  IF p_day NOT BETWEEN 1 AND 7 OR p_ends <= p_starts OR length(v_section)=0 THEN RAISE EXCEPTION 'valid section and meeting interval required'; END IF;
  INSERT INTO offerings(course_id,academic_year,semester,section,instructor_name,status) VALUES(p_course_id,p_academic_year,btrim(p_semester),v_section,nullif(btrim(p_instructor_name),''),'approved') RETURNING id INTO v_id;
  INSERT INTO offering_meetings(offering_id,day_of_week,starts_at,ends_at) VALUES(v_id,p_day,p_starts,p_ends);
  INSERT INTO offering_audit(actor_user_id,action,offering_id) VALUES(auth.user_id()::uuid,'create_offering',v_id);
  RETURN v_id;
END $$;
