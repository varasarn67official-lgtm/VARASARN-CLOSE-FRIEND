-- The grid block on the timetable page shows a teacher line for review-backed entries
-- (api.list_my_reported_timetable already returns instructor_name) but not for official
-- offering entries, even though offerings.instructor_name exists. Add it here so both
-- sources render the same code/teacher/time layout.
-- CREATE OR REPLACE cannot change a function's RETURNS TABLE column list, so this drops
-- and recreates api.list_my_timetable(); grants do not survive DROP FUNCTION and are redone.
DROP FUNCTION api.list_my_timetable();
--> statement-breakpoint
CREATE FUNCTION api.list_my_timetable()
RETURNS TABLE(offering_id uuid, course_code text, course_name text, section text,
  day_of_week integer, starts_at time, ends_at time, instructor_name text)
LANGUAGE sql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$
  SELECT s.offering_id,c.code,c.name_th,o.section,m.day_of_week,m.starts_at,m.ends_at,o.instructor_name
  FROM timetable_selections s
  JOIN offerings o ON o.id=s.offering_id
  JOIN courses c ON c.id=o.course_id
  JOIN offering_meetings m ON m.offering_id=o.id
  WHERE s.user_id=auth.user_id()::uuid
  ORDER BY m.day_of_week,m.starts_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_my_timetable() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_my_timetable() TO authenticated;
