CREATE TABLE app_private.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_name_nonempty CHECK (length(btrim(name)) > 0)
);
--> statement-breakpoint
INSERT INTO app_private.categories(name)
SELECT DISTINCT category_name FROM app_private.courses;
--> statement-breakpoint
ALTER TABLE app_private.courses ADD COLUMN category_id uuid REFERENCES app_private.categories(id);
--> statement-breakpoint
UPDATE app_private.courses c SET category_id = cat.id FROM app_private.categories cat WHERE cat.name = c.category_name;
--> statement-breakpoint
ALTER TABLE app_private.courses ALTER COLUMN category_id SET NOT NULL;
--> statement-breakpoint
CREATE TABLE app_private.catalog_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid NOT NULL REFERENCES neon_auth."user"(id),
  action text NOT NULL, course_id uuid REFERENCES app_private.courses(id), category_id uuid REFERENCES app_private.categories(id), created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE app_private.categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app_private.catalog_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION app_private.require_administrator() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
BEGIN IF NOT EXISTS (SELECT 1 FROM role_memberships WHERE user_id = auth.user_id()::uuid AND role IN ('owner', 'administrator')) THEN RAISE EXCEPTION 'administrator access required'; END IF; END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.list_approved_catalog()
RETURNS TABLE(id uuid, code text, name_th text, category_name text) LANGUAGE sql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
 SELECT c.id, c.code, c.name_th, cat.name FROM courses c JOIN categories cat ON cat.id=c.category_id WHERE c.status='approved' ORDER BY c.code
$$;
--> statement-breakpoint
CREATE FUNCTION api.list_categories() RETURNS TABLE(id uuid, name text) LANGUAGE sql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$ SELECT id, name FROM categories ORDER BY name $$;
--> statement-breakpoint
CREATE FUNCTION api.create_category(p_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$ DECLARE v_id uuid; BEGIN PERFORM app_private.require_administrator(); INSERT INTO categories(name) VALUES (btrim(p_name)) RETURNING id INTO v_id; INSERT INTO catalog_audit(actor_user_id,action,category_id) VALUES(auth.user_id()::uuid,'create_category',v_id); RETURN v_id; END $$;
--> statement-breakpoint
CREATE FUNCTION api.create_course(p_code text, p_name_th text, p_category_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$ DECLARE v_id uuid; DECLARE v_code text := upper(regexp_replace(btrim(p_code), '\\s+', '', 'g')); BEGIN PERFORM app_private.require_administrator(); IF length(v_code)=0 OR length(btrim(p_name_th))=0 THEN RAISE EXCEPTION 'course code and name are required'; END IF; INSERT INTO courses(code,name_th,category_name,category_id) SELECT v_code,btrim(p_name_th),name,id FROM categories WHERE id=p_category_id RETURNING id INTO v_id; IF v_id IS NULL THEN RAISE EXCEPTION 'category not found'; END IF; INSERT INTO catalog_audit(actor_user_id,action,course_id,category_id) VALUES(auth.user_id()::uuid,'create_course',v_id,p_category_id); RETURN v_id; END $$;
--> statement-breakpoint
CREATE FUNCTION api.update_course(p_course_id uuid,p_code text,p_name_th text,p_category_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$ BEGIN PERFORM app_private.require_administrator(); UPDATE courses c SET code=upper(regexp_replace(btrim(p_code),'\\s+','','g')),name_th=btrim(p_name_th),category_id=cat.id,category_name=cat.name FROM categories cat WHERE c.id=p_course_id AND cat.id=p_category_id; IF NOT FOUND THEN RAISE EXCEPTION 'course or category not found'; END IF; INSERT INTO catalog_audit(actor_user_id,action,course_id,category_id) VALUES(auth.user_id()::uuid,'update_course',p_course_id,p_category_id); END $$;
--> statement-breakpoint
CREATE FUNCTION api.archive_course(p_course_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$ BEGIN PERFORM app_private.require_administrator(); UPDATE courses SET status='archived' WHERE id=p_course_id; IF NOT FOUND THEN RAISE EXCEPTION 'course not found'; END IF; INSERT INTO catalog_audit(actor_user_id,action,course_id) VALUES(auth.user_id()::uuid,'archive_course',p_course_id); END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_categories(),api.create_category(text),api.create_course(text,text,uuid),api.update_course(uuid,text,text,uuid),api.archive_course(uuid) TO authenticated;
