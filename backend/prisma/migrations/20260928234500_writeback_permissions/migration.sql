-- Session 11: ERP write-backs. Grants the writebacks.* permissions to the
-- built-in roles that operate them: the service manager configures triggers,
-- warehouses and retries failures; area managers and customer support can see
-- write-back status. Only adds; never removes, so admin customisations are
-- preserved. Fresh installs end up matching BUILT_IN_ROLES in
-- src/auth/permissions.ts (checked by permissions.spec.ts, which folds later
-- migrations in).

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['writebacks.read', 'writebacks.edit']) AS p
)
WHERE "id" = 'role_service_manager';

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['writebacks.read']) AS p
)
WHERE "id" = 'role_area_manager';

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['writebacks.read']) AS p
)
WHERE "id" = 'role_cs_support';
