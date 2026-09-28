-- Session 10a: field visits. Grants the visits.* permissions to the built-in
-- roles that do field work (service manager, area manager, service engineer).
-- Only adds; never removes, so admin customisations are preserved. Fresh
-- installs end up matching BUILT_IN_ROLES in src/auth/permissions.ts
-- (checked by permissions.spec.ts, which folds later migrations in).

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['visits.read', 'visits.create', 'visits.edit', 'visits.delete']) AS p
)
WHERE "id" = 'role_service_manager';

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['visits.read', 'visits.create', 'visits.edit', 'visits.delete']) AS p
)
WHERE "id" = 'role_area_manager';

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['visits.read', 'visits.create', 'visits.edit', 'visits.delete']) AS p
)
WHERE "id" = 'role_engineer';
