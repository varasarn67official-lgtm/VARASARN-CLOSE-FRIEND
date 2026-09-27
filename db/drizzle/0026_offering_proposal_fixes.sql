-- Course merge must carry forward offering proposals so a proposer's status view keeps resolving to a
-- live course after their proposed course is merged away, matching the existing review/offering carry-forward.
CREATE OR REPLACE FUNCTION api.merge_course(p_source_course_id uuid,p_target_course_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
BEGIN
  PERFORM * FROM api.preview_course_merge(p_source_course_id,p_target_course_id);
  UPDATE reviews SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  UPDATE offerings SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  UPDATE offering_proposals SET course_id=p_target_course_id WHERE course_id=p_source_course_id;
  UPDATE courses SET status='archived' WHERE id=p_source_course_id;
  INSERT INTO course_merge_audit(actor_user_id,source_course_id,target_course_id) VALUES(auth.user_id()::uuid,p_source_course_id,p_target_course_id);
END $$;
--> statement-breakpoint
-- Approval must compare sections the same normalized way api.create_offering and the
-- offerings_normalized_section_unique index do, so an equivalent offering that differs only by case or
-- spacing is reused instead of failing the unique constraint, and must not create an offering under a
-- course that is no longer approved (e.g. archived by a merge after the proposal was submitted).
CREATE OR REPLACE FUNCTION api.resolve_offering_proposal(p_proposal_id uuid,p_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE p offering_proposals%ROWTYPE; BEGIN
  PERFORM app_private.require_administrator();
  SELECT * INTO p FROM offering_proposals WHERE id=p_proposal_id AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pending proposal not found'; END IF;
  IF p_approve THEN
    IF NOT EXISTS(SELECT 1 FROM courses WHERE id=p.course_id AND status='approved') THEN RAISE EXCEPTION 'active course required'; END IF;
    IF NOT EXISTS(
      SELECT 1 FROM offerings o WHERE o.course_id=p.course_id AND o.academic_year=p.academic_year AND o.semester=p.semester
        AND lower(regexp_replace(btrim(o.section),'[[:space:]]+','','g'))=lower(regexp_replace(btrim(p.section),'[[:space:]]+','','g'))
    ) THEN
      INSERT INTO offerings(course_id,academic_year,semester,section,instructor_name,status) VALUES(p.course_id,p.academic_year,p.semester,btrim(p.section),p.instructor_name,'approved');
    END IF;
  END IF;
  UPDATE offering_proposals SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,resolved_by=auth.user_id()::uuid,resolved_at=now() WHERE id=p_proposal_id;
END $$;
