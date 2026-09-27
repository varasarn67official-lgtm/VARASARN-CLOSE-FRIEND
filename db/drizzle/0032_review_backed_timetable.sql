-- A student's personal choice from a review is a snapshot, not an official offering.
-- No browser role receives table privileges; every operation is scoped to auth.user_id().
CREATE TABLE app_private.timetable_review_selections (
  user_id uuid NOT NULL REFERENCES neon_auth."user"(id),
  course_id uuid NOT NULL REFERENCES app_private.courses(id),
  review_id uuid NOT NULL REFERENCES app_private.reviews(id),
  academic_year integer NOT NULL CHECK (academic_year BETWEEN 2400 AND 2700),
  semester text NOT NULL CHECK (semester IN ('1', '2', 'ฤดูร้อน')),
  section text NOT NULL CHECK (length(btrim(section)) > 0),
  instructor_name text,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  starts_at time NOT NULL,
  ends_at time NOT NULL CHECK (ends_at > starts_at),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);
--> statement-breakpoint
ALTER TABLE app_private.timetable_review_selections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON app_private.timetable_review_selections FROM PUBLIC, authenticated;
--> statement-breakpoint

CREATE FUNCTION api.list_my_reported_timetable()
RETURNS TABLE(review_id uuid, course_code text, course_name text, section text,
  day_of_week integer, starts_at time, ends_at time,
  academic_year integer, semester text, instructor_name text)
LANGUAGE sql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
  SELECT s.review_id,c.code,c.name_th,s.section,s.day_of_week,s.starts_at,s.ends_at,
    s.academic_year,s.semester,s.instructor_name
  FROM timetable_review_selections s JOIN courses c ON c.id=s.course_id
  WHERE s.user_id=auth.user_id()::uuid
  ORDER BY s.day_of_week,s.starts_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_my_reported_timetable() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_my_reported_timetable() TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.add_my_timetable_review(p_review_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE
  v_user uuid := auth.user_id()::uuid;
  v_review reviews%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT r.* INTO v_review FROM reviews r JOIN courses c ON c.id=r.course_id
  WHERE r.id=p_review_id AND r.author_active AND r.moderation_visible AND c.status='approved'
    AND r.day_of_week BETWEEN 1 AND 7 AND r.starts_at IS NOT NULL
    AND r.ends_at > r.starts_at AND length(btrim(r.section))>0
  FOR SHARE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'visible review with valid class time required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_review.course_id::text, 0));
  DELETE FROM timetable_selections s USING offerings o
    WHERE s.offering_id=o.id AND s.user_id=v_user AND o.course_id=v_review.course_id;
  INSERT INTO timetable_review_selections(user_id,course_id,review_id,academic_year,semester,
    section,instructor_name,day_of_week,starts_at,ends_at)
  VALUES(v_user,v_review.course_id,v_review.id,v_review.academic_year,v_review.semester,
    v_review.section,v_review.instructor_name,v_review.day_of_week,v_review.starts_at,v_review.ends_at)
  ON CONFLICT(user_id,course_id) DO UPDATE SET
    review_id=excluded.review_id,academic_year=excluded.academic_year,semester=excluded.semester,
    section=excluded.section,instructor_name=excluded.instructor_name,
    day_of_week=excluded.day_of_week,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
    created_at=now();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_my_timetable_review(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.add_my_timetable_review(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.remove_my_timetable_review(p_review_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
BEGIN
  DELETE FROM timetable_review_selections
    WHERE user_id=auth.user_id()::uuid AND review_id=p_review_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_my_timetable_review(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.remove_my_timetable_review(uuid) TO authenticated;
--> statement-breakpoint

-- Keep a single selected class per course whether its source is official or reported.
CREATE OR REPLACE FUNCTION api.add_my_timetable_offering(p_offering_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_course_id uuid; v_user uuid := auth.user_id()::uuid;
BEGIN
  SELECT o.course_id INTO v_course_id FROM offerings o JOIN courses c ON c.id=o.course_id
    WHERE o.id=p_offering_id AND o.status='approved' AND c.status='approved'
      AND EXISTS(SELECT 1 FROM offering_meetings m WHERE m.offering_id=o.id);
  IF v_course_id IS NULL THEN RAISE EXCEPTION 'approved offering with meeting time required'; END IF;
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_course_id::text, 0));
  DELETE FROM timetable_review_selections WHERE user_id=v_user AND course_id=v_course_id;
  DELETE FROM timetable_selections s USING offerings o
    WHERE s.offering_id=o.id AND s.user_id=v_user AND o.course_id=v_course_id AND s.offering_id<>p_offering_id;
  INSERT INTO timetable_selections(user_id,offering_id) VALUES(v_user,p_offering_id) ON CONFLICT DO NOTHING;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.replace_my_timetable_offering(p_offering_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_course_id uuid; v_user uuid := auth.user_id()::uuid;
BEGIN
  SELECT o.course_id INTO v_course_id FROM offerings o JOIN courses c ON c.id=o.course_id
    WHERE o.id=p_offering_id AND o.status='approved' AND c.status='approved'
      AND EXISTS(SELECT 1 FROM offering_meetings m WHERE m.offering_id=o.id);
  IF v_course_id IS NULL THEN RAISE EXCEPTION 'approved offering with meeting time required'; END IF;
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || v_course_id::text, 0));
  DELETE FROM timetable_review_selections WHERE user_id=v_user AND course_id=v_course_id;
  DELETE FROM timetable_selections s USING offerings o
    WHERE s.offering_id=o.id AND s.user_id=v_user AND o.course_id=v_course_id;
  INSERT INTO timetable_selections(user_id,offering_id) VALUES(v_user,p_offering_id);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.clear_my_timetable()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
BEGIN
  DELETE FROM timetable_review_selections WHERE user_id=auth.user_id()::uuid;
  DELETE FROM timetable_selections WHERE user_id=auth.user_id()::uuid;
END $$;
--> statement-breakpoint

-- A merge keeps the target course's selection when both source and target were chosen.
-- If one choice is official, retain it over a reported choice.
CREATE OR REPLACE FUNCTION api.merge_course(p_source_course_id uuid,p_target_course_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
BEGIN
  PERFORM * FROM api.preview_course_merge(p_source_course_id,p_target_course_id);
  DELETE FROM timetable_review_selections s WHERE s.course_id IN (p_source_course_id,p_target_course_id)
    AND EXISTS(SELECT 1 FROM timetable_selections ts JOIN offerings o ON o.id=ts.offering_id
      WHERE ts.user_id=s.user_id AND o.course_id IN (p_source_course_id,p_target_course_id));
  DELETE FROM timetable_review_selections s WHERE s.course_id=p_source_course_id
    AND EXISTS(SELECT 1 FROM timetable_review_selections t
      WHERE t.user_id=s.user_id AND t.course_id=p_target_course_id);
  UPDATE timetable_review_selections SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  UPDATE reviews SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  UPDATE offerings SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  UPDATE offering_proposals SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  DELETE FROM timetable_selections s USING (
    SELECT ts.user_id,ts.offering_id,row_number() OVER
      (PARTITION BY ts.user_id,o.course_id ORDER BY ts.created_at,o.id) AS rank
    FROM timetable_selections ts JOIN offerings o ON o.id=ts.offering_id
    WHERE o.course_id=p_target_course_id
  ) ranked WHERE s.user_id=ranked.user_id AND s.offering_id=ranked.offering_id AND ranked.rank>1;
  UPDATE courses SET status='archived' WHERE id=p_source_course_id;
  INSERT INTO course_merge_audit(actor_user_id,source_course_id,target_course_id)
    VALUES(auth.user_id()::uuid,p_source_course_id,p_target_course_id);
END $$;
