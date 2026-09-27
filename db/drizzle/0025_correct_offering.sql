-- Administrators can correct an existing offering's factual details without touching review text or history:
-- reviews have been course-scoped and self-reported since 0024_student_reported_reviews.sql, so an offering
-- correction never reads or writes the reviews table.
CREATE FUNCTION api.update_offering(p_offering_id uuid,p_academic_year integer,p_semester text,p_section text,p_instructor_name text,p_day integer,p_starts time,p_ends time)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ DECLARE v_section text := btrim(p_section); BEGIN
  PERFORM app_private.require_administrator();
  IF NOT EXISTS(SELECT 1 FROM offerings WHERE id=p_offering_id FOR UPDATE) THEN RAISE EXCEPTION 'offering not found'; END IF;
  IF NOT EXISTS(SELECT 1 FROM academic_periods WHERE academic_year=p_academic_year AND semester=btrim(p_semester)) THEN RAISE EXCEPTION 'academic period required'; END IF;
  IF p_day NOT BETWEEN 1 AND 7 OR p_ends <= p_starts OR length(v_section)=0 THEN RAISE EXCEPTION 'valid section and meeting interval required'; END IF;
  UPDATE offerings SET academic_year=p_academic_year,semester=btrim(p_semester),section=v_section,instructor_name=nullif(btrim(p_instructor_name),'') WHERE id=p_offering_id;
  DELETE FROM offering_meetings WHERE offering_id=p_offering_id;
  INSERT INTO offering_meetings(offering_id,day_of_week,starts_at,ends_at) VALUES(p_offering_id,p_day,p_starts,p_ends);
  INSERT INTO offering_audit(actor_user_id,action,offering_id) VALUES(auth.user_id()::uuid,'update_offering',p_offering_id);
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_offering(uuid,integer,text,text,text,integer,time,time) TO authenticated;
