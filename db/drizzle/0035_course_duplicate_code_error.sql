-- courses.code already has a UNIQUE constraint (courses_code_unique), so submitting a
-- duplicate course code was never silently accepted -- but the admin only ever saw the raw
-- Postgres error ("duplicate key value violates unique constraint \"courses_code_unique\""),
-- which reads like a crash rather than "this code already exists", and the add-course modal
-- stays open on any error rather than closing/refreshing. Pre-check for the duplicate and
-- raise a message the UI can show as-is, same style as the existing "category not found" check
-- in this function.
CREATE OR REPLACE FUNCTION api.create_course(p_code text, p_name_th text, p_category_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
DECLARE
  v_id uuid;
  v_code text := upper(regexp_replace(btrim(p_code), '\s+', '', 'g'));
BEGIN
  PERFORM app_private.require_administrator();
  IF length(v_code) = 0 OR length(btrim(p_name_th)) = 0 THEN RAISE EXCEPTION 'course code and name are required'; END IF;
  IF EXISTS(SELECT 1 FROM courses WHERE code = v_code) THEN RAISE EXCEPTION 'รหัสวิชา % มีอยู่แล้ว', v_code; END IF;
  INSERT INTO courses(code,name_th,category_name,category_id) SELECT v_code,btrim(p_name_th),name,id FROM categories WHERE id=p_category_id RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'category not found'; END IF;
  INSERT INTO catalog_audit(actor_user_id,action,course_id,category_id) VALUES(auth.user_id()::uuid,'create_course',v_id,p_category_id);
  RETURN v_id;
END $$;
