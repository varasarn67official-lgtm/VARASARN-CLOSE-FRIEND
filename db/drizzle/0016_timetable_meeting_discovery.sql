CREATE FUNCTION api.list_approved_offering_meetings(p_offering_id uuid)
RETURNS TABLE(day_of_week integer, starts_at time, ends_at time)
LANGUAGE sql SECURITY DEFINER SET search_path=app_private, pg_temp
AS $$
  SELECT m.day_of_week, m.starts_at, m.ends_at
  FROM offering_meetings m
  JOIN offerings o ON o.id = m.offering_id
  JOIN courses c ON c.id = o.course_id
  WHERE m.offering_id = p_offering_id
    AND o.status = 'approved'
    AND c.status = 'approved'
    AND m.ends_at > m.starts_at
  ORDER BY m.day_of_week, m.starts_at
$$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_approved_offering_meetings(uuid) TO authenticated;
