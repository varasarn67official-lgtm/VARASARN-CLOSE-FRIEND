CREATE TABLE app_private.academic_periods (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), academic_year integer NOT NULL, semester text NOT NULL, UNIQUE(academic_year, semester));
--> statement-breakpoint
CREATE TABLE app_private.offering_meetings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offering_id uuid NOT NULL REFERENCES app_private.offerings(id) ON DELETE CASCADE, day_of_week integer NOT NULL CHECK(day_of_week BETWEEN 1 AND 7), starts_at time NOT NULL, ends_at time NOT NULL, CHECK(ends_at > starts_at));
--> statement-breakpoint
ALTER TABLE app_private.academic_periods ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app_private.offering_meetings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION api.create_academic_period(p_academic_year integer,p_semester text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ DECLARE v_id uuid; BEGIN PERFORM app_private.require_administrator(); INSERT INTO academic_periods(academic_year,semester) VALUES(p_academic_year,btrim(p_semester)) RETURNING id INTO v_id; RETURN v_id; END $$;
--> statement-breakpoint
CREATE FUNCTION api.create_offering(p_course_id uuid,p_academic_year integer,p_semester text,p_section text,p_instructor_name text,p_day integer,p_starts time,p_ends time) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=app_private,pg_temp AS $$ DECLARE v_id uuid; BEGIN PERFORM app_private.require_administrator(); IF NOT EXISTS(SELECT 1 FROM courses WHERE id=p_course_id AND status='approved') THEN RAISE EXCEPTION 'active course required'; END IF; INSERT INTO offerings(course_id,academic_year,semester,section,instructor_name,status) VALUES(p_course_id,p_academic_year,btrim(p_semester),btrim(p_section),p_instructor_name,'approved') RETURNING id INTO v_id; INSERT INTO offering_meetings(offering_id,day_of_week,starts_at,ends_at) VALUES(v_id,p_day,p_starts,p_ends); RETURN v_id; END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_academic_period(integer,text),api.create_offering(uuid,integer,text,text,text,integer,time,time) TO authenticated;
