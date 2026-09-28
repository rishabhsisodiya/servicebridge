-- Session 15: audit-log admin. Grants audit.read / audit.edit to the built-in
-- service manager (retention settings and the explicit purge action are
-- operational-admin actions), plus imports.read — implied by imports.edit via
-- normalizePermissions, so it must be granted alongside it for fresh installs to
-- match BUILT_IN_ROLES in src/auth/permissions.ts. Only adds; never removes, so
-- admin customisations are preserved. (Checked by permissions.spec.ts, which
-- folds later migrations in.)

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['audit.read', 'audit.edit', 'imports.read']) AS p
)
WHERE "id" = 'role_service_manager';
