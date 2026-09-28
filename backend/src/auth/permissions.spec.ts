import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTION_TYPES,
  ADMIN_PERMISSIONS,
  BUILT_IN_ROLES,
  normalizePermissions,
  PERMISSIONS,
  permissionsOf,
  PLANNED_PERMISSIONS,
  RECORD_TYPES,
} from './permissions';

describe('permission catalog', () => {
  it('lists every permission exactly once across grid rows, actions and planned', () => {
    const fromGrid = RECORD_TYPES.flatMap((r) => r.ops.map((op) => `${r.key}.${op}`));
    const all = [...fromGrid, ...ACTION_TYPES.map((a) => a.key), ...PLANNED_PERMISSIONS];
    expect([...all].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('gives every grid row a read permission', () => {
    for (const row of RECORD_TYPES) expect(row.ops).toContain('read');
  });
});

describe('normalizePermissions', () => {
  it('adds the implied read, drops unknown names and duplicates, and keeps catalog order', () => {
    expect(
      normalizePermissions(['tickets.assign', 'nope.read', 'users.edit', 'tickets.assign']),
    ).toEqual(['tickets.read', 'users.read', 'users.edit', 'tickets.assign']);
  });
});

describe('permissionsOf', () => {
  it('gives the locked role everything except membership actions, whatever it stores', () => {
    const perms = permissionsOf({ isLocked: true, permissions: ['tickets.work'] });
    expect(perms).toEqual(ADMIN_PERMISSIONS);
    expect(perms).not.toContain('tickets.work');
    expect(perms).not.toContain('tickets.escalations');
  });
});

describe('built-in roles', () => {
  it('store already-normalised lists, so database lookups by permission match', () => {
    for (const role of BUILT_IN_ROLES) {
      expect([...role.permissions].sort()).toEqual(
        [...normalizePermissions(role.permissions)].sort(),
      );
    }
  });

  it('match the rows the roles migration inserts', () => {
    const dir = join(__dirname, '../../prisma/migrations');
    const folder = readdirSync(dir).find((d) => d.endsWith('_custom_roles'));
    const sql = readFileSync(join(dir, folder as string, 'migration.sql'), 'utf8');
    for (const role of BUILT_IN_ROLES) {
      const row = new RegExp(
        `\\('${role.id}', '${role.key}', '${role.name}', (true|false),\\s*ARRAY\\[([^\\]]*)\\](?:::TEXT\\[\\])?,\\s*'(\\w+)'`,
      ).exec(sql);
      expect(row).not.toBeNull();
      const [, locked, list, scope] = row as RegExpExecArray;
      expect(locked === 'true').toBe(!!role.isLocked);
      expect(scope).toBe(role.ticketScope);
      const stored = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
      expect(stored).toEqual([...role.permissions].sort());
    }
  });
});
