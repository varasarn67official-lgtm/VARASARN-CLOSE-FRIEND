ALTER TABLE app_private.reviews ADD COLUMN moderation_state text NOT NULL DEFAULT 'visible' CHECK(moderation_state IN ('visible','hidden','removed'));
--> statement-breakpoint
CREATE TABLE app_private.review_moderation_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid NOT NULL REFERENCES app_private.reviews(id), actor_user_id uuid NOT NULL REFERENCES neon_auth."user"(id), prior_state text NOT NULL, new_state text NOT NULL, reason text NOT NULL CHECK(length(btrim(reason))>0), created_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
ALTER TABLE app_private.review_moderation_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION api.list_moderation_reviews(p_state text DEFAULT NULL) RETURNS TABLE(id uuid,rating integer,text text,author_active boolean,moderation_state text,created_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ BEGIN PERFORM app_private.require_administrator(); RETURN QUERY SELECT id,rating,text,author_active,moderation_state,created_at FROM reviews WHERE p_state IS NULL OR moderation_state=p_state ORDER BY created_at DESC; END $$;
--> statement-breakpoint
CREATE FUNCTION api.moderate_review(p_review_id uuid,p_state text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ DECLARE v_prior text; BEGIN PERFORM app_private.require_administrator(); IF p_state NOT IN ('visible','hidden','removed') OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'state and reason required'; END IF; SELECT moderation_state INTO v_prior FROM reviews WHERE id=p_review_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'review not found'; END IF; UPDATE reviews SET moderation_state=p_state,moderation_visible=(p_state='visible') WHERE id=p_review_id; INSERT INTO review_moderation_audit(review_id,actor_user_id,prior_state,new_state,reason) VALUES(p_review_id,auth.user_id()::uuid,v_prior,p_state,btrim(p_reason)); END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_moderation_reviews(text),api.moderate_review(uuid,text,text) TO authenticated;
