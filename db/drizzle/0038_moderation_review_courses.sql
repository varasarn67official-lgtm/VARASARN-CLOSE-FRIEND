-- Add course context to moderation rows. Changing the return shape requires DROP/CREATE,
-- so restore the authenticated EXECUTE grant explicitly, as in migration 0036.
DROP FUNCTION api.list_moderation_reviews(text);
--> statement-breakpoint
CREATE FUNCTION api.list_moderation_reviews(p_state text DEFAULT NULL)
RETURNS TABLE(id uuid, rating integer, text text, author_active boolean, moderation_state text, created_at timestamptz, course_code text, course_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$ BEGIN
  PERFORM app_private.require_administrator();
  RETURN QUERY
    SELECT r.id, r.rating, r.text, r.author_active, r.moderation_state, r.created_at, c.code, c.name_th
    FROM reviews r
    JOIN courses c ON c.id = r.course_id
    WHERE p_state IS NULL OR r.moderation_state = p_state
    ORDER BY r.created_at DESC;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_moderation_reviews(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_moderation_reviews(text) TO authenticated;
