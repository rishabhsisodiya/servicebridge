-- Session 10b: quotations. Grants the quotations.* permissions to the built-in
-- roles that price and approve work (service manager, area manager, customer
-- support). Only adds; never removes, so admin customisations are preserved.
-- Fresh installs end up matching BUILT_IN_ROLES in src/auth/permissions.ts
-- (checked by permissions.spec.ts, which folds later migrations in).

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['quotations.read', 'quotations.create', 'quotations.delete']) AS p
)
WHERE "id" = 'role_service_manager';

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['quotations.read', 'quotations.create', 'quotations.edit', 'quotations.delete']) AS p
)
WHERE "id" = 'role_area_manager';

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['quotations.read', 'quotations.create', 'quotations.delete']) AS p
)
WHERE "id" = 'role_cs_support';
