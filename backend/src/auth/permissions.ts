import { Role } from '@prisma/client';

/**
 * Everything a user can be allowed to do. Checked on the server for every
 * request; the web app only uses the list to hide menu entries.
 */
export const PERMISSIONS = [
  'tickets.view',
  'tickets.viewAll', // every region, not just the user's own
  'tickets.create',
  'tickets.assign',
  'tickets.work', // engineer actions: accept, on site, resolve
  'tickets.verify',
  'customers.view',
  'equipment.view',
  'items.view',
  'amc.view',
  'amc.manage',
  'quotations.manage',
  'reports.view',
  'reports.schedule',
  'users.manage',
  'settings.manage',
  'erp.manage',
  'automations.manage',
  'system.monitor',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const SERVICE_DESK: Permission[] = [
  'tickets.view',
  'customers.view',
  'equipment.view',
  'items.view',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  SERVICE_MANAGER: [
    ...SERVICE_DESK,
    'tickets.viewAll',
    'tickets.create',
    'tickets.assign',
    'tickets.verify',
    'amc.view',
    'amc.manage',
    'quotations.manage',
    'reports.view',
    'reports.schedule',
  ],
  AREA_MANAGER: [...SERVICE_DESK, 'tickets.create', 'tickets.assign', 'tickets.verify', 'amc.view'],
  ENGINEER: ['tickets.view', 'tickets.work', 'equipment.view', 'items.view'],
  CALL_CENTER: [...SERVICE_DESK, 'tickets.viewAll', 'tickets.create'],
  CS_SUPPORT: [...SERVICE_DESK, 'tickets.viewAll', 'amc.view', 'amc.manage', 'quotations.manage'],
  EXECUTIVE: ['tickets.view', 'tickets.viewAll', 'reports.view'],
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  SERVICE_MANAGER: 'Service manager',
  AREA_MANAGER: 'Area manager',
  ENGINEER: 'Service engineer',
  CALL_CENTER: 'Call center',
  CS_SUPPORT: 'Customer support',
  EXECUTIVE: 'Executive',
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
