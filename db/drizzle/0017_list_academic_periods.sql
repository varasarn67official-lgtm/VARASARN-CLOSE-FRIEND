CREATE FUNCTION api.list_academic_periods()
RETURNS TABLE(id uuid, academic_year integer, semester text)
LANGUAGE sql SECURITY DEFINER SET search_path=app_private, pg_temp
AS $$ SELECT id, academic_year, semester FROM academic_periods ORDER BY academic_year DESC, semester $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_academic_periods() TO authenticated;
