CREATE TABLE app_private.course_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid NOT NULL REFERENCES neon_auth."user"(id),
  source_course_id uuid NOT NULL REFERENCES app_private.courses(id), target_course_id uuid NOT NULL REFERENCES app_private.courses(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE app_private.course_merge_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION api.preview_course_merge(p_source_course_id uuid, p_target_course_id uuid)
RETURNS TABLE(source_code text, target_code text, offerings_to_move bigint, reviews_preserved bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
BEGIN
  PERFORM app_private.require_administrator();
  IF p_source_course_id = p_target_course_id THEN RAISE EXCEPTION 'source and target must differ'; END IF;
  IF NOT EXISTS (SELECT 1 FROM courses WHERE id=p_source_course_id) OR NOT EXISTS (SELECT 1 FROM courses WHERE id=p_target_course_id) THEN RAISE EXCEPTION 'course not found'; END IF;
  IF EXISTS (SELECT 1 FROM offerings s JOIN offerings t ON t.course_id=p_target_course_id AND s.course_id=p_source_course_id AND t.academic_year=s.academic_year AND t.semester=s.semester AND t.section=s.section) THEN RAISE EXCEPTION 'offering conflict prevents merge'; END IF;
  RETURN QUERY SELECT s.code,t.code,(SELECT count(*) FROM offerings WHERE course_id=s.id),(SELECT count(*) FROM reviews r JOIN offerings o ON o.id=r.offering_id WHERE o.course_id=s.id) FROM courses s,courses t WHERE s.id=p_source_course_id AND t.id=p_target_course_id;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.merge_course(p_source_course_id uuid, p_target_course_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
BEGIN
  PERFORM * FROM api.preview_course_merge(p_source_course_id,p_target_course_id);
  UPDATE offerings SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  UPDATE courses SET status='archived' WHERE id=p_source_course_id;
  INSERT INTO course_merge_audit(actor_user_id,source_course_id,target_course_id) VALUES(auth.user_id()::uuid,p_source_course_id,p_target_course_id);
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.preview_course_merge(uuid,uuid),api.merge_course(uuid,uuid) TO authenticated;
