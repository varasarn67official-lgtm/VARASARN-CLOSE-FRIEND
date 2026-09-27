CREATE TABLE app_private.timetable_selections (user_id uuid NOT NULL REFERENCES neon_auth."user"(id), offering_id uuid NOT NULL REFERENCES app_private.offerings(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,offering_id));
--> statement-breakpoint
ALTER TABLE app_private.timetable_selections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION api.list_my_timetable() RETURNS TABLE(offering_id uuid,course_code text,course_name text,section text,day_of_week integer,starts_at time,ends_at time) LANGUAGE sql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ SELECT s.offering_id,c.code,c.name_th,o.section,m.day_of_week,m.starts_at,m.ends_at FROM timetable_selections s JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id JOIN offering_meetings m ON m.offering_id=o.id WHERE s.user_id=auth.user_id()::uuid ORDER BY m.day_of_week,m.starts_at $$;
--> statement-breakpoint
CREATE FUNCTION api.add_my_timetable_offering(p_offering_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM offerings o JOIN courses c ON c.id=o.course_id WHERE o.id=p_offering_id AND o.status='approved' AND c.status='approved' AND EXISTS(SELECT 1 FROM offering_meetings m WHERE m.offering_id=o.id)) THEN RAISE EXCEPTION 'approved offering with meeting time required'; END IF; INSERT INTO timetable_selections(user_id,offering_id) VALUES(auth.user_id()::uuid,p_offering_id) ON CONFLICT DO NOTHING; END $$;
--> statement-breakpoint
CREATE FUNCTION api.remove_my_timetable_offering(p_offering_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ BEGIN DELETE FROM timetable_selections WHERE user_id=auth.user_id()::uuid AND offering_id=p_offering_id; END $$;
--> statement-breakpoint
CREATE FUNCTION api.clear_my_timetable() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ BEGIN DELETE FROM timetable_selections WHERE user_id=auth.user_id()::uuid; END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_my_timetable(),api.add_my_timetable_offering(uuid),api.remove_my_timetable_offering(uuid),api.clear_my_timetable() TO authenticated;
