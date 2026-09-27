-- Offering proposals ("เสนอข้อเสนอกลุ่มเรียน") previously sat as status='pending' until an
-- administrator called api.resolve_offering_proposal to turn one into a real offering. The
-- owner asked to skip that admin-review step for this stage (real moderation is a future
-- feature, not needed right now): a proposal now publishes itself as an approved offering
-- immediately on submission. api.resolve_offering_proposal is left untouched and unused for
-- now -- reverting this function and no longer auto-approving new rows is enough to bring
-- the review step back later.
CREATE OR REPLACE FUNCTION api.create_offering_proposal(p_course_id uuid, p_academic_year integer, p_semester text, p_section text, p_instructor_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
DECLARE
  v_id uuid;
  v_semester text := btrim(p_semester);
  v_section text := btrim(p_section);
BEGIN
  IF auth.user_id() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM courses WHERE id = p_course_id AND status = 'approved') THEN RAISE EXCEPTION 'active course required'; END IF;
  INSERT INTO offering_proposals(proposer_user_id, course_id, academic_year, semester, section, instructor_name, status, resolved_at)
  VALUES (auth.user_id()::uuid, p_course_id, p_academic_year, v_semester, v_section, p_instructor_name, 'approved', now())
  RETURNING id INTO v_id;
  IF NOT EXISTS(SELECT 1 FROM offerings WHERE course_id = p_course_id AND academic_year = p_academic_year AND semester = v_semester AND section = v_section) THEN
    INSERT INTO offerings(course_id, academic_year, semester, section, instructor_name, status)
    VALUES (p_course_id, p_academic_year, v_semester, v_section, p_instructor_name, 'approved');
  END IF;
  RETURN v_id;
END $$;
