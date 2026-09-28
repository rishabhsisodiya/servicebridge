import type { TicketScope } from '@prisma/client';

/**
 * Everything a role can be allowed to do. Checked on the server for every
 * request; the web app only uses the list to decide what to show.
 *
 * Record permissions are `<record>.<read|create|edit|delete>`; the rest are
 * named workflow actions. Roles store these names, so renaming one needs a
 * data migration.
 */
export const PERMISSIONS = [
  // Record grid
  'tickets.read',
  'tickets.create',
  'tickets.edit',
  'visits.read',
  'visits.create',
  'visits.edit',
  'visits.delete',
  'quotations.read',
  'quotations.create',
  'quotations.edit',
  'quotations.delete',
  'writebacks.read',
  'writebacks.edit',
  'customers.read',
  'equipment.read',
  'items.read',
  'rules.read',
  'rules.edit',
  'users.read',
  'users.create',
  'users.edit',
  'users.delete',
  'roles.read',
  'roles.create',
  'roles.edit',
  'roles.delete',
  'company.read',
  'company.edit',
  'erp.read',
  'erp.edit',
  'automations.read',
  'automations.edit',
  'system.read',
  'system.edit',
  'audit.read',
  // Workflow actions
  'tickets.assign',
  'tickets.work',
  'tickets.verify',
  'tickets.escalations',
  'demo.manage',
  // Planned screens (AMC, reports); their sessions add grid rows
  'amc.read',
  'amc.edit',
  'reports.read',
  'reports.schedule',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RecordOp = 'read' | 'create' | 'edit' | 'delete';

export interface RecordType {
  key: string;
  label: string;
  ops: RecordOp[];
  hint?: string;
}

/** Rows of the permission grid, in display order. */
export const RECORD_TYPES: RecordType[] = [
  {
    key: 'tickets',
    label: 'Tickets',
    ops: ['read', 'create', 'edit'],
    hint: 'Tickets are cancelled, never deleted.',
  },
  {
    key: 'visits',
    label: 'Field visits',
    ops: ['read', 'create', 'edit', 'delete'],
    hint: 'Drafts can be edited and deleted; submitted visits are locked.',
  },
  {
    key: 'quotations',
    label: 'Quotations',
    ops: ['read', 'create', 'edit', 'delete'],
    hint: 'Drafts can be edited and deleted; sent quotations are locked.',
  },
  {
    key: 'writebacks',
    label: 'ERP write-backs',
    ops: ['read', 'edit'],
    hint: 'See invoice and stock-entry write-backs; edit retries failures and configures triggers and warehouses.',
  },
  {
    key: 'amc',
    label: 'AMC contracts',
    ops: ['read', 'edit'],
    hint: 'Annual maintenance contracts, planned PM visits and renewal alerts.',
  },
  { key: 'customers', label: 'Customers', ops: ['read'] },
  { key: 'equipment', label: 'Equipment', ops: ['read'] },
  { key: 'items', label: 'Spares & items', ops: ['read'] },
  {
    key: 'rules',
    label: 'Service rules',
    ops: ['read', 'edit'],
    hint: 'SLA, calendars, service types, priorities, billing, regions and skills.',
  },
  {
    key: 'users',
    label: 'Users',
    ops: ['read', 'create', 'edit', 'delete'],
    hint: 'Create sends invites; delete deactivates.',
  },
  { key: 'roles', label: 'Roles', ops: ['read', 'create', 'edit', 'delete'] },
  { key: 'company', label: 'Company settings', ops: ['read', 'edit'] },
  { key: 'erp', label: 'ERP connections', ops: ['read', 'edit'] },
  { key: 'automations', label: 'Automations', ops: ['read', 'edit'] },
  {
    key: 'system',
    label: 'System monitor',
    ops: ['read', 'edit'],
    hint: 'Edit retries, pauses and cleans queued jobs.',
  },
  { key: 'audit', label: 'Audit log', ops: ['read'] },
];

export interface ActionType {
  key: Permission;
  label: string;
  hint: string;
}

export const ACTION_TYPES: ActionType[] = [
  {
    key: 'tickets.assign',
    label: 'Assign tickets',
    hint: 'Assign engineers, change priority, cancel tickets and manage engineers’ availability.',
  },
  {
    key: 'tickets.work',
    label: 'Work on tickets',
    hint: 'Makes people with this role engineers: they can be assigned tickets, set their availability and have skills.',
  },
  {
    key: 'tickets.verify',
    label: 'Verify & close',
    hint: 'Check resolved tickets and close them.',
  },
  {
    key: 'tickets.escalations',
    label: 'Receive escalations',
    hint: 'Alerts for tickets with no region or area manager, and SLA breaches.',
  },
  { key: 'demo.manage', label: 'Manage demo data', hint: 'Load and clear demo data.' },
];

/** Kept for built-in roles until their screens are built; not shown in the grid. */
export const PLANNED_PERMISSIONS: Permission[] = ['reports.read', 'reports.schedule'];

/**
 * Administrator has everything except the two actions that put someone into a
 * group: the engineer pool and the escalation recipients.
 */
export const MEMBERSHIP_ACTIONS: Permission[] = ['tickets.work', 'tickets.escalations'];
export const ADMIN_PERMISSIONS: Permission[] = PERMISSIONS.filter(
  (p) => !MEMBERSHIP_ACTIONS.includes(p),
);

const KNOWN = new Set<string>(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return KNOWN.has(value);
}

/**
 * Drops unknown names and duplicates, and adds the read permission that any
 * other permission on the same record needs (e.g. `tickets.assign` → `tickets.read`).
 */
export function normalizePermissions(values: readonly string[]): Permission[] {
  const result = new Set<Permission>();
  for (const value of values) {
    if (!isPermission(value)) continue;
    result.add(value);
    const read = `${value.split('.')[0]}.read`;
    if (isPermission(read)) result.add(read);
  }
  return PERMISSIONS.filter((p) => result.has(p));
}

/** What a stored role grants. The locked Administrator role always gets the full set. */
export function permissionsOf(role: { isLocked: boolean; permissions: readonly string[] }) {
  return role.isLocked ? [...ADMIN_PERMISSIONS] : normalizePermissions(role.permissions);
}

export function can(user: { permissions: readonly Permission[] }, permission: Permission) {
  return user.permissions.includes(permission);
}

export interface BuiltInRole {
  id: string;
  key: string;
  name: string;
  ticketScope: TicketScope;
  isLocked?: boolean;
  permissions: Permission[];
}

const DESK: Permission[] = ['tickets.read', 'customers.read', 'equipment.read', 'items.read'];
const MANAGER: Permission[] = [
  ...DESK,
  'tickets.create',
  'tickets.edit',
  'tickets.assign',
  'tickets.verify',
];

/**
 * The starter roles every install gets. The roles migration inserts exactly
 * these rows (a spec keeps the two in step); after that admins may edit them,
 * so code must never read permissions from here at runtime.
 */
export const BUILT_IN_ROLES: BuiltInRole[] = [
  {
    id: 'role_admin',
    key: 'ADMIN',
    name: 'Administrator',
    ticketScope: 'ALL',
    isLocked: true,
    permissions: [],
  },
  {
    id: 'role_service_manager',
    key: 'SERVICE_MANAGER',
    name: 'Service manager',
    ticketScope: 'ALL',
    permissions: [
      ...MANAGER,
      'tickets.escalations',
      'visits.read',
      'visits.create',
      'visits.edit',
      'visits.delete',
      'quotations.read',
      'quotations.create',
      'quotations.edit',
      'quotations.delete',
      'writebacks.read',
      'writebacks.edit',
      'amc.read',
      'amc.edit',
      'reports.read',
      'reports.schedule',
    ],
  },
  {
    id: 'role_area_manager',
    key: 'AREA_MANAGER',
    name: 'Area manager',
    ticketScope: 'REGION',
    permissions: [
      ...MANAGER,
      'visits.read',
      'visits.create',
      'visits.edit',
      'visits.delete',
      'quotations.read',
      'quotations.create',
      'quotations.edit',
      'quotations.delete',
      'writebacks.read',
      'amc.read',
    ],
  },
  {
    id: 'role_engineer',
    key: 'ENGINEER',
    name: 'Service engineer',
    ticketScope: 'OWN',
    permissions: [
      'tickets.read',
      'tickets.work',
      'equipment.read',
      'items.read',
      'visits.read',
      'visits.create',
      'visits.edit',
      'visits.delete',
    ],
  },
  {
    id: 'role_call_center',
    key: 'CALL_CENTER',
    name: 'Call center',
    ticketScope: 'ALL',
    permissions: [...DESK, 'tickets.create', 'tickets.edit'],
  },
  {
    id: 'role_cs_support',
    key: 'CS_SUPPORT',
    name: 'Customer support',
    ticketScope: 'ALL',
    permissions: [
      ...DESK,
      'amc.read',
      'amc.edit',
      'quotations.read',
      'quotations.create',
      'quotations.edit',
      'quotations.delete',
      'writebacks.read',
    ],
  },
  {
    id: 'role_executive',
    key: 'EXECUTIVE',
    name: 'Executive',
    ticketScope: 'ALL',
    permissions: ['tickets.read', 'reports.read'],
  },
];

export const ADMIN_ROLE_ID = 'role_admin';

export function builtInRoleId(key: string): string {
  const role = BUILT_IN_ROLES.find((r) => r.key === key);
  if (!role) throw new Error(`Unknown built-in role ${key}`);
  return role.id;
}
