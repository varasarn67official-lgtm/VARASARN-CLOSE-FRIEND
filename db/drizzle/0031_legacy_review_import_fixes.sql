-- Legacy reviews previously created a status='rejected' placeholder offering per class. Nothing ever moves
-- an offering from rejected to approved, so that placeholder permanently blocked api.create_offering for
-- the same class (unique index) and made api.resolve_offering_proposal "reuse" it while it stayed
-- unselectable. Since 0024 a review carries its own course/year/semester/section context, so a legacy
-- review now does the same and never touches offerings; the class only becomes selectable when an
-- administrator creates it through the ordinary offering paths.
ALTER TABLE app_private.legacy_import_audit ALTER COLUMN actor_user_id DROP NOT NULL;
--> statement-breakpoint
-- The DB-owner script cannot present a Neon Auth identity, so it is recorded as such rather than
-- attributed to an account.
ALTER TABLE app_private.legacy_import_audit ADD COLUMN via text NOT NULL DEFAULT 'owner_rpc';
--> statement-breakpoint
ALTER TABLE app_private.legacy_import_audit ADD CONSTRAINT legacy_import_audit_via_check CHECK (
  (via='owner_rpc' AND actor_user_id IS NOT NULL) OR (via='database_script' AND actor_user_id IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX reviews_legacy_context_text_unique ON app_private.reviews(
  course_id,academic_year,semester,lower(regexp_replace(btrim(section),'[[:space:]]+','','g')),text
) WHERE is_legacy;
--> statement-breakpoint
CREATE FUNCTION app_private.import_legacy_review_rows(p_rows jsonb)
RETURNS TABLE(imported_count integer,duplicate_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE r jsonb; v_row text; v_course uuid; v_next uuid; v_hops integer; v_year integer;
  v_semester text; v_section text; v_text text; v_inserted integer;
  v_imported integer := 0; v_duplicates integer := 0;
BEGIN
  IF jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'rows must be an array'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_row := coalesce(r->>'sourceRow','?');
    SELECT id INTO v_course FROM courses
      WHERE code=upper(regexp_replace(btrim(coalesce(r->>'courseCode','')),'[[:space:]]+','','g'));
    IF v_course IS NULL THEN RAISE EXCEPTION 'legacy row %: course % is not in the catalog',v_row,r->>'courseCode'; END IF;
    -- A code merged away before import lands where merge_course would have moved the review.
    v_hops := 0;
    LOOP
      v_next := NULL;
      SELECT a.target_course_id INTO v_next FROM course_merge_audit a
        WHERE a.source_course_id=v_course ORDER BY a.created_at DESC LIMIT 1;
      EXIT WHEN v_next IS NULL OR v_hops>=10;
      v_course := v_next; v_hops := v_hops+1;
    END LOOP;
    v_year := CASE WHEN (r->>'year') ~ '^[0-9]+$' THEN (r->>'year')::integer END;
    v_semester := btrim(r->>'semester'); v_section := btrim(r->>'section'); v_text := btrim(r->>'text');
    IF coalesce(r->>'rating','') !~ '^[1-5]$' OR length(coalesce(v_text,''))=0
      OR v_year IS NULL OR v_year NOT BETWEEN 2400 AND 2700
      OR coalesce(v_semester,'') NOT IN ('1','2','ฤดูร้อน') OR length(coalesce(v_section,''))=0
      OR coalesce(r->>'createdAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
    THEN RAISE EXCEPTION 'legacy row %: invalid rating, text, year, semester, section, or createdAt',v_row; END IF;
    INSERT INTO reviews(author_user_id,course_id,offering_id,academic_year,semester,section,
      instructor_name,rating,text,created_at,is_legacy)
    VALUES(NULL,v_course,NULL,v_year,v_semester,v_section,nullif(btrim(r->>'instructorName'),''),
      (r->>'rating')::integer,v_text,(r->>'createdAt')::timestamptz,true)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted=1 THEN v_imported := v_imported+1; ELSE v_duplicates := v_duplicates+1; END IF;
  END LOOP;
  RETURN QUERY SELECT v_imported,v_duplicates;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.import_legacy_review_rows(jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.import_legacy_reviews(p_rows jsonb)
RETURNS TABLE(imported_count integer,duplicate_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_imported integer; v_duplicates integer;
BEGIN
  PERFORM app_private.require_owner();
  SELECT i.imported_count,i.duplicate_count INTO v_imported,v_duplicates
    FROM app_private.import_legacy_review_rows(p_rows) i;
  INSERT INTO legacy_import_audit(actor_user_id,via,source_rows,imported_count,duplicate_count)
  VALUES(auth.user_id()::uuid,'owner_rpc',jsonb_array_length(p_rows),v_imported,v_duplicates);
  RETURN QUERY SELECT v_imported,v_duplicates;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.import_legacy_reviews(jsonb) FROM PUBLIC;
