-- Session 15: Partner API and bulk import. Grants the partner.* and imports.*
-- permissions to the built-in role that operates them: the service manager
-- creates and revokes partner API keys and runs bulk CSV imports. Only adds;
-- never removes, so admin customisations are preserved. Fresh installs end up
-- matching BUILT_IN_ROLES in src/auth/permissions.ts (checked by
-- permissions.spec.ts, which folds later migrations in).

UPDATE "Role"
SET "permissions" = (
  SELECT array_agg(DISTINCT p ORDER BY p)
  FROM unnest("permissions" || ARRAY['partner.read', 'partner.edit', 'imports.edit']) AS p
)
WHERE "id" = 'role_service_manager';
