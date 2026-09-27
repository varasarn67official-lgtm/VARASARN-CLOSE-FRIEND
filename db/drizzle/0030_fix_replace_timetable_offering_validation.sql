-- api.replace_my_timetable_offering only ever checked offerings.status='approved', so unlike
-- api.add_my_timetable_offering it let a user select an approved offering under an archived course, or an
-- approved offering with no meeting rows, by replacing rather than adding -- exactly the selection-rule
-- bypass Ticket 13 item 2 requires be closed. Match add's validation so both entry points enforce the
-- same rule.
CREATE OR REPLACE FUNCTION api.replace_my_timetable_offering(p_offering_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
DECLARE v_course_id uuid; BEGIN
  SELECT o.course_id INTO v_course_id FROM offerings o JOIN courses c ON c.id=o.course_id
    WHERE o.id=p_offering_id AND o.status='approved' AND c.status='approved' AND EXISTS(SELECT 1 FROM offering_meetings m WHERE m.offering_id=o.id);
  IF v_course_id IS NULL THEN RAISE EXCEPTION 'approved offering with meeting time required'; END IF;
  DELETE FROM timetable_selections s USING offerings o WHERE s.offering_id=o.id AND s.user_id=auth.user_id()::uuid AND o.course_id=v_course_id;
  INSERT INTO timetable_selections(user_id,offering_id) VALUES(auth.user_id()::uuid,p_offering_id);
END $$;
