-- Run once as the Neon database owner after the intended owner has completed Google sign-in.
-- Replace the UUID with the verified account ID displayed by the owner dashboard query.
-- This is intentionally not an API endpoint: database-owner access is the bootstrap control.
BEGIN;

WITH verified_google_owner AS (
  SELECT u.id
  FROM neon_auth."user" u
  JOIN neon_auth.account a ON a."userId" = u.id AND a."providerId" = 'google'
  WHERE u.id = 'REPLACE_WITH_VERIFIED_GOOGLE_USER_UUID'::uuid
    AND u."emailVerified"
    AND NOT u.banned
), created_owner AS (
  INSERT INTO app_private.role_memberships(user_id, role, granted_by)
  SELECT id, 'owner', id FROM verified_google_owner
  RETURNING user_id
)
INSERT INTO app_private.role_audit(actor_user_id, target_user_id, action)
SELECT user_id, user_id, 'bootstrap_owner' FROM created_owner;

COMMIT;
