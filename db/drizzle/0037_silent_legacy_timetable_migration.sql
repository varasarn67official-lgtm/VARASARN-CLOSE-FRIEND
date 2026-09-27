-- Preserve browser-only timetable rows without publishing them to the shared catalog.
CREATE TABLE app_private.timetable_legacy_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  entry_hash text NOT NULL,
  course_code text NOT NULL CHECK (length(btrim(course_code)) > 0),
  course_name text NOT NULL DEFAULT '',
  section text NOT NULL CHECK (length(btrim(section)) > 0),
  instructor_name text,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  starts_at time NOT NULL,
  ends_at time NOT NULL CHECK (ends_at > starts_at),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, entry_hash)
);
ALTER TABLE app_private.timetable_legacy_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.timetable_legacy_entries FROM PUBLIC, authenticated;
--> statement-breakpoint

-- Receipts survive timetable removals and clear operations, so a later visit never
-- silently recreates a class that the student has removed.
CREATE TABLE app_private.legacy_timetable_migration_receipts (
  user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE CASCADE,
  migration_version integer NOT NULL CHECK (migration_version > 0),
  entry_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('added-official', 'added-legacy', 'already-present', 'invalid', 'conflict')),
  offering_id uuid REFERENCES app_private.offerings(id) ON DELETE SET NULL,
  legacy_entry_id uuid REFERENCES app_private.timetable_legacy_entries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, migration_version, entry_hash)
);
ALTER TABLE app_private.legacy_timetable_migration_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.legacy_timetable_migration_receipts FROM PUBLIC, authenticated;
--> statement-breakpoint

CREATE FUNCTION api.list_my_legacy_timetable()
RETURNS TABLE(legacy_entry_id uuid, course_code text, course_name text, section text,
  day_of_week integer, starts_at time, ends_at time, instructor_name text)
LANGUAGE sql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
  SELECT id,course_code,course_name,section,day_of_week,starts_at,ends_at,instructor_name
  FROM timetable_legacy_entries WHERE user_id=auth.user_id()::uuid
  ORDER BY day_of_week,starts_at,course_code
$$;
REVOKE ALL ON FUNCTION api.list_my_legacy_timetable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.list_my_legacy_timetable() TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.remove_my_legacy_timetable_entry(p_legacy_entry_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_user uuid := auth.user_id()::uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':timetable', 0));
  DELETE FROM timetable_legacy_entries WHERE id=p_legacy_entry_id AND user_id=v_user;
END $$;
REVOKE ALL ON FUNCTION api.remove_my_legacy_timetable_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.remove_my_legacy_timetable_entry(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.migrate_legacy_timetable_entry(p_migration_version integer, p_entry jsonb, p_conflicting boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE
  v_user uuid := auth.user_id()::uuid;
  v_raw_hash text;
  v_entry_hash text;
  v_code text;
  v_name text;
  v_section text;
  v_teacher text;
  v_day_name text;
  v_day integer;
  v_start_text text;
  v_end_text text;
  v_start time;
  v_end time;
  v_canonical jsonb;
  v_outcome text;
  v_existing app_private.legacy_timetable_migration_receipts%ROWTYPE;
  v_course_id uuid;
  v_offering_id uuid;
  v_exact_count integer := 0;
  v_course_count integer := 0;
  v_legacy_id uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF p_migration_version IS NULL OR p_migration_version < 1 OR jsonb_typeof(p_entry) <> 'object' THEN
    RAISE EXCEPTION 'migration version and timetable entry required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':timetable', 0));
  v_raw_hash := md5(p_entry::text);
  v_code := nullif(btrim(p_entry->>'code'), '');
  v_name := coalesce(btrim(p_entry->>'name'), '');
  v_section := nullif(btrim(p_entry->>'sec'), '');
  v_teacher := nullif(btrim(p_entry->>'teacher'), '');
  v_day_name := btrim(coalesce(p_entry->>'day', ''));
  v_day := CASE v_day_name WHEN 'จันทร์' THEN 1 WHEN 'อังคาร' THEN 2 WHEN 'พุธ' THEN 3
    WHEN 'พฤหัสบดี' THEN 4 WHEN 'ศุกร์' THEN 5 WHEN 'เสาร์' THEN 6 WHEN 'อาทิตย์' THEN 7 ELSE NULL END;
  v_start_text := btrim(coalesce(p_entry->>'start', ''));
  v_end_text := btrim(coalesce(p_entry->>'end', ''));

  IF v_code IS NULL OR v_section IS NULL OR v_day IS NULL
    OR v_start_text !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
    OR v_end_text !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    v_entry_hash := v_raw_hash;
    v_outcome := 'invalid';
  ELSE
    v_start := v_start_text::time;
    v_end := v_end_text::time;
    v_canonical := jsonb_build_object(
      'code', upper(regexp_replace(v_code, '[[:space:]]+', '', 'g')),
      'name', v_name,
      'section', lower(regexp_replace(v_section, '[[:space:]]+', '', 'g')),
      'teacher', coalesce(v_teacher, ''), 'day', v_day, 'start', v_start::text, 'end', v_end::text
    );
    v_entry_hash := md5(v_canonical::text);
    IF v_end <= v_start THEN v_outcome := 'invalid'; END IF;
  END IF;

  SELECT * INTO v_existing FROM legacy_timetable_migration_receipts
  WHERE user_id=v_user AND migration_version=p_migration_version AND entry_hash=v_entry_hash;
  IF FOUND THEN
    RETURN jsonb_build_object('entry_hash',v_entry_hash,'outcome',v_existing.outcome,
      'offering_id',v_existing.offering_id,'legacy_entry_id',v_existing.legacy_entry_id,'replayed',true);
  END IF;

  IF v_outcome IS NULL AND p_conflicting THEN v_outcome := 'conflict'; END IF;

  IF v_outcome IS NULL THEN
    -- A saved course already on the account is never replaced. An exact selection is
    -- reconciled; a different selection is a terminal conflict.
    SELECT c.id INTO v_course_id FROM courses c
    WHERE upper(regexp_replace(btrim(c.code), '[[:space:]]+', '', 'g')) = upper(regexp_replace(v_code, '[[:space:]]+', '', 'g'))
    LIMIT 1;

    IF EXISTS (
      SELECT 1 FROM timetable_selections s JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id
      WHERE s.user_id=v_user AND upper(regexp_replace(btrim(c.code), '[[:space:]]+', '', 'g'))=upper(regexp_replace(v_code, '[[:space:]]+', '', 'g'))
    ) OR (v_course_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM timetable_review_selections s WHERE s.user_id=v_user AND s.course_id=v_course_id
    )) OR EXISTS (
      SELECT 1 FROM timetable_legacy_entries s WHERE s.user_id=v_user
        AND upper(regexp_replace(btrim(s.course_code), '[[:space:]]+', '', 'g'))=upper(regexp_replace(v_code, '[[:space:]]+', '', 'g'))
    ) THEN
      IF EXISTS (
        SELECT 1 FROM timetable_selections s JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id
        JOIN offering_meetings m ON m.offering_id=o.id
        WHERE s.user_id=v_user AND upper(regexp_replace(btrim(c.code), '[[:space:]]+', '', 'g'))=upper(regexp_replace(v_code, '[[:space:]]+', '', 'g'))
          AND lower(regexp_replace(btrim(o.section), '[[:space:]]+', '', 'g'))=lower(regexp_replace(v_section, '[[:space:]]+', '', 'g'))
          AND m.day_of_week=v_day AND m.starts_at=v_start AND m.ends_at=v_end
          AND coalesce(btrim(o.instructor_name),'')=coalesce(v_teacher,'')
      ) OR EXISTS (
        SELECT 1 FROM timetable_review_selections s WHERE s.user_id=v_user AND s.course_id=v_course_id
          AND lower(regexp_replace(btrim(s.section), '[[:space:]]+', '', 'g'))=lower(regexp_replace(v_section, '[[:space:]]+', '', 'g'))
          AND s.day_of_week=v_day AND s.starts_at=v_start AND s.ends_at=v_end
          AND coalesce(btrim(s.instructor_name),'')=coalesce(v_teacher,'')
      ) OR EXISTS (
        SELECT 1 FROM timetable_legacy_entries s WHERE s.user_id=v_user
          AND upper(regexp_replace(btrim(s.course_code), '[[:space:]]+', '', 'g'))=upper(regexp_replace(v_code, '[[:space:]]+', '', 'g'))
          AND lower(regexp_replace(btrim(s.section), '[[:space:]]+', '', 'g'))=lower(regexp_replace(v_section, '[[:space:]]+', '', 'g'))
          AND s.day_of_week=v_day AND s.starts_at=v_start AND s.ends_at=v_end
          AND coalesce(btrim(s.instructor_name),'')=coalesce(v_teacher,'')
      ) THEN v_outcome := 'already-present';
      ELSE v_outcome := 'conflict'; END IF;
    END IF;

    IF v_outcome IS NULL THEN
      SELECT count(*) INTO v_course_count FROM offerings o JOIN courses c ON c.id=o.course_id
      WHERE o.status='approved' AND c.status='approved'
        AND upper(regexp_replace(btrim(c.code), '[[:space:]]+', '', 'g'))=upper(regexp_replace(v_code, '[[:space:]]+', '', 'g'))
        AND lower(regexp_replace(btrim(o.section), '[[:space:]]+', '', 'g'))=lower(regexp_replace(v_section, '[[:space:]]+', '', 'g'));

      SELECT count(*), min(o.id::text)::uuid INTO v_exact_count,v_offering_id
      FROM offerings o JOIN courses c ON c.id=o.course_id
      WHERE o.status='approved' AND c.status='approved'
        AND upper(regexp_replace(btrim(c.code), '[[:space:]]+', '', 'g'))=upper(regexp_replace(v_code, '[[:space:]]+', '', 'g'))
        AND lower(regexp_replace(btrim(o.section), '[[:space:]]+', '', 'g'))=lower(regexp_replace(v_section, '[[:space:]]+', '', 'g'))
        AND coalesce(btrim(o.instructor_name),'')=coalesce(v_teacher,'')
        AND (SELECT count(*) FROM offering_meetings m WHERE m.offering_id=o.id)=1
        AND EXISTS (SELECT 1 FROM offering_meetings m WHERE m.offering_id=o.id AND m.day_of_week=v_day AND m.starts_at=v_start AND m.ends_at=v_end);

      IF v_exact_count=1 AND v_course_count=1 THEN
        IF EXISTS (
          SELECT 1 FROM timetable_selections s JOIN offerings o ON o.id=s.offering_id
          JOIN offering_meetings m ON m.offering_id=o.id
          WHERE s.user_id=v_user AND o.id=v_offering_id
            AND m.day_of_week=v_day AND m.starts_at=v_start AND m.ends_at=v_end
        ) THEN
          v_outcome := 'already-present';
        ELSIF EXISTS (
          SELECT 1 FROM timetable_selections s JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id
          WHERE s.user_id=v_user AND c.id=v_course_id
        ) OR EXISTS (SELECT 1 FROM timetable_review_selections s WHERE s.user_id=v_user AND s.course_id=v_course_id)
          OR EXISTS (SELECT 1 FROM timetable_legacy_entries s WHERE s.user_id=v_user
            AND upper(regexp_replace(btrim(s.course_code), '[[:space:]]+', '', 'g'))=upper(regexp_replace(v_code, '[[:space:]]+', '', 'g'))) THEN
          v_outcome := 'conflict';
        ELSIF EXISTS (
          SELECT 1 FROM timetable_selections s JOIN offering_meetings m ON m.offering_id=s.offering_id
          WHERE s.user_id=v_user AND m.day_of_week=v_day AND m.starts_at < v_end AND m.ends_at > v_start
        ) OR EXISTS (
          SELECT 1 FROM timetable_review_selections s WHERE s.user_id=v_user AND s.day_of_week=v_day AND s.starts_at < v_end AND s.ends_at > v_start
        ) OR EXISTS (
          SELECT 1 FROM timetable_legacy_entries s WHERE s.user_id=v_user AND s.day_of_week=v_day AND s.starts_at < v_end AND s.ends_at > v_start
        ) THEN
          v_outcome := 'conflict';
        ELSE
          INSERT INTO timetable_selections(user_id,offering_id) VALUES(v_user,v_offering_id) ON CONFLICT DO NOTHING;
          IF FOUND THEN v_outcome := 'added-official'; ELSE v_outcome := 'already-present'; END IF;
        END IF;
      ELSIF v_course_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM timetable_selections s JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id
        WHERE s.user_id=v_user AND c.id=v_course_id
      ) THEN
        v_outcome := 'conflict';
      ELSE
        IF EXISTS (
          SELECT 1 FROM timetable_selections s JOIN offering_meetings m ON m.offering_id=s.offering_id
          WHERE s.user_id=v_user AND m.day_of_week=v_day AND m.starts_at < v_end AND m.ends_at > v_start
        ) OR EXISTS (
          SELECT 1 FROM timetable_review_selections s WHERE s.user_id=v_user AND s.day_of_week=v_day AND s.starts_at < v_end AND s.ends_at > v_start
        ) OR EXISTS (
          SELECT 1 FROM timetable_legacy_entries s WHERE s.user_id=v_user AND s.day_of_week=v_day AND s.starts_at < v_end AND s.ends_at > v_start
        ) THEN
          v_outcome := 'conflict';
        ELSE
          INSERT INTO timetable_legacy_entries(user_id,entry_hash,course_code,course_name,section,instructor_name,day_of_week,starts_at,ends_at)
          VALUES(v_user,v_entry_hash,v_code,v_name,v_section,v_teacher,v_day,v_start,v_end)
          ON CONFLICT(user_id,entry_hash) DO NOTHING
          RETURNING id INTO v_legacy_id;
          IF v_legacy_id IS NULL THEN
            SELECT id INTO v_legacy_id FROM timetable_legacy_entries WHERE user_id=v_user AND entry_hash=v_entry_hash;
          END IF;
          v_outcome := 'added-legacy';
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO legacy_timetable_migration_receipts(user_id,migration_version,entry_hash,outcome,offering_id,legacy_entry_id)
  VALUES(v_user,p_migration_version,v_entry_hash,v_outcome,
    CASE WHEN v_outcome='added-official' THEN v_offering_id END,
    CASE WHEN v_outcome='added-legacy' THEN v_legacy_id END);
  RETURN jsonb_build_object('entry_hash',v_entry_hash,'outcome',v_outcome,
    'offering_id',CASE WHEN v_outcome='added-official' THEN v_offering_id END,
    'legacy_entry_id',CASE WHEN v_outcome='added-legacy' THEN v_legacy_id END,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION api.migrate_legacy_timetable_entry(integer,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.migrate_legacy_timetable_entry(integer,jsonb,boolean) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.add_my_timetable_offering(p_offering_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_course_id uuid; v_user uuid := auth.user_id()::uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT o.course_id INTO v_course_id FROM offerings o JOIN courses c ON c.id=o.course_id
    WHERE o.id=p_offering_id AND o.status='approved' AND c.status='approved'
      AND EXISTS(SELECT 1 FROM offering_meetings m WHERE m.offering_id=o.id);
  IF v_course_id IS NULL THEN RAISE EXCEPTION 'approved offering with meeting time required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':timetable', 0));
  DELETE FROM timetable_review_selections WHERE user_id=v_user AND course_id=v_course_id;
  DELETE FROM timetable_legacy_entries WHERE user_id=v_user
    AND upper(regexp_replace(btrim(course_code), '[[:space:]]+', '', 'g'))=upper((SELECT regexp_replace(btrim(code), '[[:space:]]+', '', 'g') FROM courses WHERE id=v_course_id));
  DELETE FROM timetable_selections s USING offerings o
    WHERE s.offering_id=o.id AND s.user_id=v_user AND o.course_id=v_course_id AND s.offering_id<>p_offering_id;
  INSERT INTO timetable_selections(user_id,offering_id) VALUES(v_user,p_offering_id) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION api.add_my_timetable_offering(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.add_my_timetable_offering(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.add_my_timetable_review(p_review_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_user uuid := auth.user_id()::uuid; v_review reviews%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT r.* INTO v_review FROM reviews r JOIN courses c ON c.id=r.course_id
  WHERE r.id=p_review_id AND r.author_active AND r.moderation_visible AND c.status='approved'
    AND r.day_of_week BETWEEN 1 AND 7 AND r.starts_at IS NOT NULL AND r.ends_at>r.starts_at AND length(btrim(r.section))>0
  FOR SHARE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'visible review with valid class time required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':timetable', 0));
  DELETE FROM timetable_selections s USING offerings o WHERE s.offering_id=o.id AND s.user_id=v_user AND o.course_id=v_review.course_id;
  DELETE FROM timetable_legacy_entries WHERE user_id=v_user
    AND upper(regexp_replace(btrim(course_code), '[[:space:]]+', '', 'g'))=upper((SELECT regexp_replace(btrim(code), '[[:space:]]+', '', 'g') FROM courses WHERE id=v_review.course_id));
  INSERT INTO timetable_review_selections(user_id,course_id,review_id,academic_year,semester,section,instructor_name,day_of_week,starts_at,ends_at)
  VALUES(v_user,v_review.course_id,v_review.id,v_review.academic_year,v_review.semester,v_review.section,v_review.instructor_name,v_review.day_of_week,v_review.starts_at,v_review.ends_at)
  ON CONFLICT(user_id,course_id) DO UPDATE SET review_id=excluded.review_id,academic_year=excluded.academic_year,
    semester=excluded.semester,section=excluded.section,instructor_name=excluded.instructor_name,
    day_of_week=excluded.day_of_week,starts_at=excluded.starts_at,ends_at=excluded.ends_at,created_at=now();
END $$;
REVOKE ALL ON FUNCTION api.add_my_timetable_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.add_my_timetable_review(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.replace_my_timetable_offering(p_offering_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_course_id uuid; v_user uuid := auth.user_id()::uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT o.course_id INTO v_course_id FROM offerings o JOIN courses c ON c.id=o.course_id
    WHERE o.id=p_offering_id AND o.status='approved' AND c.status='approved'
      AND EXISTS(SELECT 1 FROM offering_meetings m WHERE m.offering_id=o.id);
  IF v_course_id IS NULL THEN RAISE EXCEPTION 'approved offering with meeting time required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':timetable', 0));
  DELETE FROM timetable_review_selections WHERE user_id=v_user AND course_id=v_course_id;
  DELETE FROM timetable_legacy_entries WHERE user_id=v_user
    AND upper(regexp_replace(btrim(course_code), '[[:space:]]+', '', 'g'))=upper((SELECT regexp_replace(btrim(code), '[[:space:]]+', '', 'g') FROM courses WHERE id=v_course_id));
  DELETE FROM timetable_selections s USING offerings o WHERE s.offering_id=o.id AND s.user_id=v_user AND o.course_id=v_course_id;
  INSERT INTO timetable_selections(user_id,offering_id) VALUES(v_user,p_offering_id);
END $$;
REVOKE ALL ON FUNCTION api.replace_my_timetable_offering(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.replace_my_timetable_offering(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.remove_my_timetable_offering(p_offering_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_user uuid := auth.user_id()::uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':timetable', 0));
  DELETE FROM timetable_selections WHERE user_id=v_user AND offering_id=p_offering_id;
END $$;
REVOKE ALL ON FUNCTION api.remove_my_timetable_offering(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.remove_my_timetable_offering(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.remove_my_timetable_review(p_review_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_user uuid := auth.user_id()::uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':timetable', 0));
  DELETE FROM timetable_review_selections WHERE user_id=v_user AND review_id=p_review_id;
END $$;
REVOKE ALL ON FUNCTION api.remove_my_timetable_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.remove_my_timetable_review(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.clear_my_timetable()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_user uuid := auth.user_id()::uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text || ':timetable', 0));
  DELETE FROM timetable_review_selections WHERE user_id=v_user;
  DELETE FROM timetable_selections WHERE user_id=v_user;
  DELETE FROM timetable_legacy_entries WHERE user_id=v_user;
END $$;
REVOKE ALL ON FUNCTION api.clear_my_timetable() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.clear_my_timetable() TO authenticated;
