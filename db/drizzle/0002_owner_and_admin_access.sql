CREATE TABLE app_private.role_memberships (
  user_id uuid PRIMARY KEY,
  role text NOT NULL,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_memberships_role_check CHECK (role IN ('owner', 'administrator')),
  CONSTRAINT role_memberships_user_fk FOREIGN KEY (user_id) REFERENCES neon_auth."user"(id),
  CONSTRAINT role_memberships_granted_by_fk FOREIGN KEY (granted_by) REFERENCES neon_auth."user"(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX role_memberships_single_owner ON app_private.role_memberships (role) WHERE role = 'owner';
--> statement-breakpoint
CREATE TABLE app_private.role_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES neon_auth."user"(id),
  target_user_id uuid NOT NULL REFERENCES neon_auth."user"(id),
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_audit_action_check CHECK (action IN ('bootstrap_owner', 'grant_administrator', 'revoke_administrator'))
);
--> statement-breakpoint
CREATE FUNCTION app_private.verify_google_role_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, neon_auth, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM neon_auth."user" u
    JOIN neon_auth.account a ON a."userId" = u.id AND a."providerId" = 'google'
    WHERE u.id = NEW.user_id AND u."emailVerified" AND NOT u.banned
  ) THEN
    RAISE EXCEPTION 'role membership requires a verified Google account';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER role_memberships_verify_google_user
BEFORE INSERT OR UPDATE OF user_id ON app_private.role_memberships
FOR EACH ROW EXECUTE FUNCTION app_private.verify_google_role_member();
--> statement-breakpoint
ALTER TABLE app_private.role_memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE app_private.role_audit ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE FUNCTION app_private.require_owner()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM role_memberships
    WHERE user_id = auth.user_id()::uuid AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'owner access required';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.current_access()
RETURNS TABLE(role text) LANGUAGE sql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
  SELECT role FROM role_memberships WHERE user_id = auth.user_id()::uuid
$$;
--> statement-breakpoint
CREATE FUNCTION api.list_verified_accounts()
RETURNS TABLE(id uuid, name text, email text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, neon_auth, pg_temp AS $$
BEGIN
  PERFORM app_private.require_owner();
  RETURN QUERY
    SELECT DISTINCT u.id, u.name, u.email
    FROM neon_auth."user" u
    JOIN neon_auth.account a ON a."userId" = u.id AND a."providerId" = 'google'
    WHERE u."emailVerified" AND NOT u.banned
    ORDER BY u.email;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.list_role_assignments()
RETURNS TABLE(user_id uuid, name text, email text, role text, granted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, neon_auth, pg_temp AS $$
BEGIN
  PERFORM app_private.require_owner();
  RETURN QUERY
    SELECT m.user_id, u.name, u.email, m.role, m.granted_at
    FROM role_memberships m JOIN neon_auth."user" u ON u.id = m.user_id
    ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.email;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.grant_administrator(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
BEGIN
  PERFORM app_private.require_owner();
  IF EXISTS (SELECT 1 FROM role_memberships WHERE user_id = p_user_id AND role = 'owner') THEN
    RAISE EXCEPTION 'the owner role cannot be changed here';
  END IF;
  INSERT INTO role_memberships(user_id, role, granted_by)
  VALUES (p_user_id, 'administrator', auth.user_id()::uuid)
  ON CONFLICT (user_id) DO UPDATE SET role = 'administrator', granted_by = EXCLUDED.granted_by, granted_at = now();
  INSERT INTO role_audit(actor_user_id, target_user_id, action)
  VALUES (auth.user_id()::uuid, p_user_id, 'grant_administrator');
END $$;
--> statement-breakpoint
CREATE FUNCTION api.revoke_administrator(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app_private, pg_temp AS $$
BEGIN
  PERFORM app_private.require_owner();
  DELETE FROM role_memberships WHERE user_id = p_user_id AND role = 'administrator';
  IF NOT FOUND THEN RAISE EXCEPTION 'administrator role not found'; END IF;
  INSERT INTO role_audit(actor_user_id, target_user_id, action)
  VALUES (auth.user_id()::uuid, p_user_id, 'revoke_administrator');
END $$;
--> statement-breakpoint
REVOKE ALL ON app_private.role_memberships, app_private.role_audit FROM PUBLIC, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.require_owner() FROM PUBLIC, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.current_access(), api.list_verified_accounts(), api.list_role_assignments(), api.grant_administrator(uuid), api.revoke_administrator(uuid) TO authenticated;
