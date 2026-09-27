-- Changing the catalog RPC return shape requires recreating it; restore its authenticated grant after DROP.
DROP FUNCTION api.list_approved_catalog();
--> statement-breakpoint
CREATE FUNCTION api.list_approved_catalog()
RETURNS TABLE(id uuid, code text, name_th text, category_name text, review_count integer, average_rating numeric)
LANGUAGE sql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$
  SELECT c.id, c.code, c.name_th, cat.name,
         count(r.id)::integer,
         round(avg(r.rating)::numeric, 1)
  FROM courses c
  JOIN categories cat ON cat.id = c.category_id
  LEFT JOIN reviews r ON r.course_id = c.id AND r.author_active AND r.moderation_visible
  WHERE c.status = 'approved'
  GROUP BY c.id, cat.id
  ORDER BY c.code
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_approved_catalog() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_approved_catalog() TO authenticated;
