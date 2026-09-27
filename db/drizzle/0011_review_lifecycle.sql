CREATE TABLE app_private.review_revisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid NOT NULL REFERENCES app_private.reviews(id), rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5), text text NOT NULL CHECK(length(btrim(text))>0), revised_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
ALTER TABLE app_private.review_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION api.list_my_reviews() RETURNS TABLE(id uuid,offering_id uuid,rating integer,text text,author_active boolean,created_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ SELECT id,offering_id,rating,text,author_active,created_at FROM reviews WHERE author_user_id=auth.user_id() ORDER BY created_at DESC $$;
--> statement-breakpoint
CREATE FUNCTION api.update_my_review(p_review_id uuid,p_rating integer,p_text text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ BEGIN INSERT INTO review_revisions(review_id,rating,text) SELECT id,rating,text FROM reviews WHERE id=p_review_id AND author_user_id=auth.user_id(); IF NOT FOUND THEN RAISE EXCEPTION 'review not found'; END IF; UPDATE reviews SET rating=p_rating,text=btrim(p_text),author_active=true WHERE id=p_review_id AND author_user_id=auth.user_id(); END $$;
--> statement-breakpoint
CREATE FUNCTION api.set_my_review_active(p_review_id uuid,p_active boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ BEGIN UPDATE reviews SET author_active=p_active WHERE id=p_review_id AND author_user_id=auth.user_id(); IF NOT FOUND THEN RAISE EXCEPTION 'review not found'; END IF; END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_my_reviews(),api.update_my_review(uuid,integer,text),api.set_my_review_active(uuid,boolean) TO authenticated;
