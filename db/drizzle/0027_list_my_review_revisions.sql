-- api.update_my_review has written immutable prior revisions into review_revisions since
-- 0011_review_lifecycle.sql, but no RPC ever let anyone -- including the author -- read them back:
-- the table has no grant of its own, and app_private's default privileges revoke every new table from
-- PUBLIC and authenticated (0001_security_api.sql). Add the author-scoped read.
CREATE FUNCTION api.list_my_review_revisions(p_review_id uuid)
RETURNS TABLE(id uuid, rating integer, text text, revised_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$
  SELECT rr.id, rr.rating, rr.text, rr.revised_at
  FROM review_revisions rr
  JOIN reviews r ON r.id = rr.review_id
  WHERE rr.review_id = p_review_id AND r.author_user_id = auth.user_id()
  ORDER BY rr.revised_at DESC
$$;
--> statement-breakpoint
-- 0001_security_api.sql's `ALTER DEFAULT PRIVILEGES IN SCHEMA api REVOKE ALL ON FUNCTIONS FROM PUBLIC`
-- never actually took effect (pg_default_acl for schema api is empty), so every function since that did
-- not add its own explicit REVOKE, including this ticket's api.update_my_review and
-- api.set_my_review_active from 0011_review_lifecycle.sql, is still executable by PUBLIC alongside
-- `authenticated`. Every one of them still enforces its real authorization inside the function body
-- (auth.user_id() scoping or require_administrator()/require_owner()), and the Data API itself refuses
-- every request without a valid bearer token regardless of grants, so this has not been an authorization
-- bypass in practice -- but it is real defense-in-depth debt. Close it here for this ticket's three
-- review-lifecycle functions; the same gap on every other api function is tracked separately.
REVOKE ALL ON FUNCTION api.list_my_review_revisions(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_my_review(uuid,integer,text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_my_review_active(uuid,boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_my_review_revisions(uuid) TO authenticated;
