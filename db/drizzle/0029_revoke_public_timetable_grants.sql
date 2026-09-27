-- Same gap as 0027/0028 (0001's ALTER DEFAULT PRIVILEGES never took effect for schema api): every
-- timetable function is still executable by PUBLIC, not just authenticated. Each already scopes itself
-- to auth.user_id(), so this has not been a bypass, but Ticket 12's "no support override exists" is a
-- statement about grants as much as behavior. Covers this and Ticket 13's replace function; the rest of
-- the schema is tracked separately (task_3ac0b026).
REVOKE ALL ON FUNCTION api.list_my_timetable() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_my_timetable_offering(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_my_timetable_offering(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.clear_my_timetable() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.replace_my_timetable_offering(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_approved_offering_meetings(uuid) FROM PUBLIC;
