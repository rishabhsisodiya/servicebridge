-- Session 14: reports. Grants reports.read to area managers (the KPI-by-region
-- view is theirs). Service managers, executives and administrators already hold
-- the reports.* permissions in BUILT_IN_ROLES. Only adds; never removes, so
-- admin customisations are preserved. Fresh installs end up matching
-- BUILT_IN_ROLES in src/auth/permissions.ts (checked by permissions.spec.ts,
-- which folds later migrations in).

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['reports.read']) AS p
)
WHERE "id" = 'role_area_manager';
