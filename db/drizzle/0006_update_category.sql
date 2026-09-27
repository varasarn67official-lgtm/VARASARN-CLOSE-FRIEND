CREATE FUNCTION api.update_category(p_category_id uuid, p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
BEGIN
  PERFORM app_private.require_administrator();
  UPDATE categories SET name = btrim(p_name) WHERE id = p_category_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'category not found'; END IF;
  UPDATE courses SET category_name = btrim(p_name) WHERE category_id = p_category_id;
  INSERT INTO catalog_audit(actor_user_id, action, category_id) VALUES(auth.user_id()::uuid, 'update_category', p_category_id);
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_category(uuid, text) TO authenticated;
