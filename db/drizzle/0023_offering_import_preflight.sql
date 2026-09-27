CREATE FUNCTION api.preview_offering_import(p_rows jsonb)
RETURNS TABLE(
  row_number integer, course_code text, academic_year integer, semester text, section text,
  instructor_name text, day_of_week integer, starts_at text, ends_at text,
  valid boolean, action text, reason text, offering_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$
DECLARE
  r jsonb;
  v_year_text text;
  v_day_text text;
  v_course_id uuid;
  v_course_status text;
  v_offering_status text;
  v_existing_instructor text;
  v_meeting_count integer;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  PERFORM app_private.require_administrator();
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rows must be an array';
  END IF;

  row_number := 0;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row_number := row_number + 1;
    course_code := upper(regexp_replace(btrim(coalesce(r->>'courseCode', '')), '\s+', '', 'g'));
    v_year_text := coalesce(r->>'academicYear', '');
    v_day_text := coalesce(r->>'dayOfWeek', '');
    academic_year := NULL;
    day_of_week := NULL;
    semester := btrim(coalesce(r->>'semester', ''));
    section := btrim(coalesce(r->>'section', ''));
    instructor_name := nullif(btrim(coalesce(r->>'instructorName', '')), '');
    starts_at := btrim(coalesce(r->>'startsAt', ''));
    ends_at := btrim(coalesce(r->>'endsAt', ''));
    valid := false;
    action := NULL;
    reason := NULL;
    offering_id := NULL;

    IF v_year_text ~ '^[0-9]{1,10}$' THEN
      IF v_year_text::bigint BETWEEN 1 AND 2147483647 THEN
        academic_year := v_year_text::integer;
      END IF;
    END IF;
    IF v_day_text ~ '^[1-7]$' THEN
      day_of_week := v_day_text::integer;
    END IF;

    IF course_code = '' OR academic_year IS NULL OR semester = '' OR section = ''
       OR day_of_week IS NULL
       OR starts_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR ends_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR ends_at <= starts_at THEN
      reason := 'กรอกข้อมูลกลุ่มเรียนหรือเวลาเรียนไม่ถูกต้อง';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT c.id, c.status INTO v_course_id, v_course_status
    FROM courses AS c WHERE c.code = preview_offering_import.course_code;
    IF v_course_id IS NULL THEN
      reason := 'ไม่พบรหัสรายวิชา';
      RETURN NEXT;
      CONTINUE;
    END IF;
    IF v_course_status <> 'approved' THEN
      reason := 'รายวิชาถูกเก็บเข้าคลัง';
      RETURN NEXT;
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM academic_periods AS ap
      WHERE ap.academic_year = preview_offering_import.academic_year
        AND ap.semester = preview_offering_import.semester
    ) THEN
      reason := 'ยังไม่มีภาคการศึกษานี้';
      RETURN NEXT;
      CONTINUE;
    END IF;

    v_key := jsonb_build_array(v_course_id, academic_year, semester, lower(section))::text;
    IF v_key = ANY(v_seen) THEN
      reason := 'กลุ่มเรียนซ้ำในไฟล์นำเข้า';
      RETURN NEXT;
      CONTINUE;
    END IF;
    v_seen := array_append(v_seen, v_key);

    SELECT o.id, o.status, o.instructor_name
      INTO offering_id, v_offering_status, v_existing_instructor
    FROM offerings AS o
    WHERE o.course_id = v_course_id AND o.academic_year = preview_offering_import.academic_year
      AND o.semester = preview_offering_import.semester
      AND lower(btrim(o.section)) = lower(preview_offering_import.section);

    IF offering_id IS NULL THEN
      valid := true;
      action := 'create';
    ELSIF v_offering_status <> 'approved' THEN
      reason := 'กลุ่มเรียนเดิมยังไม่ได้รับอนุมัติ';
    ELSE
      SELECT count(*) INTO v_meeting_count
      FROM offering_meetings AS m WHERE m.offering_id = preview_offering_import.offering_id;
      IF coalesce(v_existing_instructor, '') = coalesce(instructor_name, '')
         AND EXISTS (
           SELECT 1 FROM offering_meetings AS m
           WHERE m.offering_id = preview_offering_import.offering_id
             AND m.day_of_week = preview_offering_import.day_of_week
             AND m.starts_at = preview_offering_import.starts_at::time
             AND m.ends_at = preview_offering_import.ends_at::time
         ) THEN
        valid := true;
        action := 'existing';
        reason := 'มีกลุ่มเรียนนี้แล้ว';
      ELSIF v_meeting_count > 1 THEN
        reason := 'กลุ่มเรียนเดิมมีหลายช่วงเวลา กรุณาแก้ไขแยกต่างหาก';
      ELSE
        valid := true;
        action := 'update';
      END IF;
    END IF;
    RETURN NEXT;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE app_private.offering_import_audit
ADD COLUMN updated_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
DROP FUNCTION api.bulk_import_offerings(jsonb);
--> statement-breakpoint
CREATE FUNCTION api.bulk_import_offerings(p_rows jsonb)
RETURNS TABLE(created_count integer, updated_count integer, existing_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$
DECLARE
  p record;
  v_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_existing integer := 0;
BEGIN
  PERFORM app_private.require_administrator();
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'one or more rows required';
  END IF;

  FOR p IN SELECT * FROM api.preview_offering_import(p_rows) LOOP
    IF NOT p.valid THEN
      RAISE EXCEPTION 'invalid offering row %: %', p.row_number, p.reason;
    END IF;
    IF p.action = 'create' THEN
      INSERT INTO offerings (course_id, academic_year, semester, section, instructor_name, status)
      SELECT c.id, p.academic_year, p.semester, p.section, p.instructor_name, 'approved'
      FROM courses AS c WHERE c.code = p.course_code AND c.status = 'approved'
      ON CONFLICT DO NOTHING RETURNING id INTO v_id;
      IF v_id IS NULL THEN RAISE EXCEPTION 'offering changed; preview again'; END IF;
      INSERT INTO offering_meetings (offering_id, day_of_week, starts_at, ends_at)
      VALUES (v_id, p.day_of_week, p.starts_at::time, p.ends_at::time);
      v_created := v_created + 1;
    ELSIF p.action = 'update' THEN
      UPDATE offerings AS o SET instructor_name = p.instructor_name
      WHERE o.id = p.offering_id AND o.status = 'approved';
      IF NOT FOUND THEN RAISE EXCEPTION 'offering changed; preview again'; END IF;
      DELETE FROM offering_meetings AS m WHERE m.offering_id = p.offering_id;
      INSERT INTO offering_meetings (offering_id, day_of_week, starts_at, ends_at)
      VALUES (p.offering_id, p.day_of_week, p.starts_at::time, p.ends_at::time);
      v_updated := v_updated + 1;
    ELSE
      v_existing := v_existing + 1;
    END IF;
  END LOOP;

  INSERT INTO offering_import_audit (actor_user_id, source_rows, created_count, updated_count, existing_count)
  VALUES (auth.user_id()::uuid, jsonb_array_length(p_rows), v_created, v_updated, v_existing);
  RETURN QUERY SELECT v_created, v_updated, v_existing;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.preview_offering_import(jsonb), api.bulk_import_offerings(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.preview_offering_import(jsonb), api.bulk_import_offerings(jsonb) TO authenticated;
