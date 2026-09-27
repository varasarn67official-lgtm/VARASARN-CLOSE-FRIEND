CREATE FUNCTION api.list_pending_offering_proposals()
RETURNS TABLE(id uuid, course_code text, academic_year integer, semester text, section text, instructor_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private, pg_temp
AS $$ BEGIN
  PERFORM app_private.require_administrator();
  RETURN QUERY SELECT p.id,c.code,p.academic_year,p.semester,p.section,p.instructor_name FROM offering_proposals p JOIN courses c ON c.id=p.course_id WHERE p.status='pending' ORDER BY p.created_at;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_pending_offering_proposals() TO authenticated;
