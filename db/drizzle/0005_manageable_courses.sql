CREATE FUNCTION api.list_manageable_courses()
RETURNS TABLE(id uuid, code text, name_th text, category_id uuid, category_name text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
BEGIN
  PERFORM app_private.require_administrator();
  RETURN QUERY SELECT c.id, c.code, c.name_th, c.category_id, cat.name, c.status
  FROM courses c JOIN categories cat ON cat.id = c.category_id ORDER BY c.status, c.code;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_manageable_courses() TO authenticated;
