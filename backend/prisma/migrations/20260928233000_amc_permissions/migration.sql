-- Session 12: AMC contracts. Grants the amc.* permissions to the built-in roles
-- that manage contracts (service manager, area manager, customer support).
-- Only adds; never removes, so admin customisations are preserved. Fresh
-- installs end up matching BUILT_IN_ROLES in src/auth/permissions.ts (checked
-- by permissions.spec.ts, which folds later migrations in).

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['amc.read', 'amc.edit']) AS p
)
WHERE "id" = 'role_service_manager';

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['amc.read']) AS p
)
WHERE "id" = 'role_area_manager';

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['amc.read', 'amc.edit']) AS p
)
WHERE "id" = 'role_cs_support';
