-- api.list_moderation_reviews (0012_review_moderation.sql) has failed on every call with
-- `column reference "id" is ambiguous`: its unqualified column names collide with its own RETURNS TABLE
-- output names, which PL/pgSQL rejects by default. The moderation dashboard has therefore never loaded a
-- review. Same signature and behavior, with every column qualified.
CREATE OR REPLACE FUNCTION api.list_moderation_reviews(p_state text DEFAULT NULL)
RETURNS TABLE(id uuid, rating integer, text text, author_active boolean, moderation_state text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$ BEGIN
  PERFORM app_private.require_administrator();
  RETURN QUERY
    SELECT r.id, r.rating, r.text, r.author_active, r.moderation_state, r.created_at
    FROM reviews r
    WHERE p_state IS NULL OR r.moderation_state = p_state
    ORDER BY r.created_at DESC;
END $$;
--> statement-breakpoint
-- api.moderate_review has appended actor, reason, prior/new state, and time to review_moderation_audit
-- since 0012_review_moderation.sql, but nothing could read it back, so an administrator could not see why
-- or by whom a review was hidden, restored, or removed. Add an administrator-only, per-review read.
-- It names the acting administrator (the point of the audit) but never the review's author, which this
-- table does not store and this query does not join to.
CREATE FUNCTION api.list_review_moderation_audit(p_review_id uuid)
RETURNS TABLE(id uuid, prior_state text, new_state text, reason text, actor_name text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp
AS $$ BEGIN
  PERFORM app_private.require_administrator();
  RETURN QUERY
    SELECT a.id, a.prior_state, a.new_state, a.reason, u.name, a.created_at
    FROM review_moderation_audit a
    JOIN neon_auth."user" u ON u.id = a.actor_user_id
    WHERE a.review_id = p_review_id
    ORDER BY a.created_at DESC;
END $$;
--> statement-breakpoint
-- Explicit, because 0001's ALTER DEFAULT PRIVILEGES never took effect for schema api (see 0027). Covers
-- this ticket's three moderation functions; the rest of the schema is tracked separately.
REVOKE ALL ON FUNCTION api.list_review_moderation_audit(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_moderation_reviews(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.moderate_review(uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_review_moderation_audit(uuid) TO authenticated;
