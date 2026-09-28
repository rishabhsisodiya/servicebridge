import {
  Activity,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Cog,
  Database,
  FileText,
  Gauge,
  LayoutDashboard,
  MapPin,
  Palette,
  PlusCircle,
  Scale,
  ScrollText,
  ShieldCheck,
  Tags,
  Ticket,
  UserRound,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/auth/session";

export interface NavItem {
  href: string;
  /** Shown only to users with this permission (or any of these). */
  permission?: Permission | Permission[];
  label: string;
  icon: LucideIcon;
  /** Build session that delivers this screen; absent once the screen is real. */
  plannedSession?: number;
  /** One line shown on the placeholder and in search. */
  summary: string;
  /** Hidden from the sidebar (still searchable and routable). */
  hidden?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Home", icon: LayoutDashboard, summary: "Your overview for today." },
      {
        href: "/my-tickets",
        permission: "tickets.work",
        label: "My tickets",
        icon: ClipboardList,
        summary: "An engineer's own tickets, availability and self-assign.",
      },
    ],
  },
  {
    label: "Service",
    items: [
      {
        href: "/tickets",
        permission: "tickets.read",
        label: "Tickets",
        icon: Ticket,
        summary: "Every service ticket, with filters and SLA status.",
      },
      {
        href: "/tickets/new",
        permission: "tickets.create",
        label: "Log a ticket",
        icon: PlusCircle,
        summary: "Record a breakdown or service request with duplicate checks and routing.",
      },
      {
        href: "/customers",
        permission: "customers.read",
        label: "Customers",
        icon: Building2,
        summary: "Customers, sites and contacts, synced from your ERP.",
      },
      {
        href: "/equipment",
        permission: "equipment.read",
        label: "Equipment",
        icon: Wrench,
        summary: "Machines installed at customer sites, with coverage and history.",
      },
      {
        href: "/amc",
        permission: "amc.read",
        label: "AMC contracts",
        icon: ShieldCheck,
        plannedSession: 12,
        summary: "Maintenance contracts, planned visits and renewals.",
      },
      {
        href: "/items",
        permission: "items.read",
        label: "Spares & items",
        icon: Boxes,
        summary: "Spare parts, prices and stock from your ERP.",
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        href: "/reports",
        permission: "reports.read",
        label: "Reports",
        icon: FileText,
        plannedSession: 14,
        summary: "Run and export service reports.",
      },
      {
        href: "/reports/kpi",
        permission: "reports.read",
        label: "KPI matrix",
        icon: Gauge,
        plannedSession: 14,
        summary: "Service KPIs against targets, by region.",
      },
      {
        href: "/reports/schedules",
        permission: "reports.schedule",
        label: "Scheduled reports",
        icon: CalendarClock,
        plannedSession: 14,
        summary: "Reports emailed automatically on a schedule.",
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        href: "/settings",
        permission: [
          "rules.read",
          "users.read",
          "erp.read",
          "automations.read",
          "system.read",
          "company.read",
        ],
        label: "Settings",
        icon: Cog,
        summary: "Configure users, ERP connections, service rules and more.",
      },
      {
        href: "/settings/users",
        permission: "users.read",
        label: "Users & roles",
        icon: Users,
        summary: "Invite people and set their role and region.",
      },
      {
        href: "/settings/erp",
        permission: "erp.read",
        label: "ERP connections",
        icon: Database,
        summary: "Connect ERPNext, test it, and choose what each connection is used for.",
      },
      {
        href: "/settings/automations",
        permission: "automations.read",
        label: "Automations",
        icon: Workflow,
        summary: "Switch SLA alerts, escalations, syncs and write-backs on or off.",
      },
      {
        href: "/settings/system",
        permission: "system.read",
        label: "System monitor",
        icon: Activity,
        summary: "Queues, scheduled jobs, ERP requests and webhooks.",
      },
      {
        href: "/settings/audit-log",
        permission: "audit.read",
        label: "Audit log",
        icon: ScrollText,
        plannedSession: 15,
        summary: "Every change, who made it and when.",
      },
      {
        href: "/settings/service-rules",
        permission: "rules.read",
        label: "Service rules",
        icon: Scale,
        hidden: true,
        summary: "SLA targets and calendars, service types, priorities, stage labels and billing.",
      },
      {
        href: "/settings/regions",
        permission: "rules.read",
        label: "Regions",
        icon: MapPin,
        hidden: true,
        summary: "Pincodes and area manager for each service region.",
      },
      {
        href: "/settings/skills",
        permission: "rules.read",
        label: "Skill tags",
        icon: Tags,
        hidden: true,
        summary: "Machine skills used to suggest engineers.",
      },
      {
        href: "/settings/company",
        permission: "company.read",
        label: "Company & demo data",
        icon: Building2,
        hidden: true,
        summary: "Company name, time zone, currency and GST rate; load or clear demo data.",
      },
      {
        href: "/settings/design-system",
        label: "Design system",
        icon: Palette,
        hidden: true,
        summary: "Colours, components and UI states used across the app.",
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV.flatMap((group) => group.items);

/** Extra entries that appear in search but not in the sidebar. */
export const QUICK_LINKS: NavItem[] = [
  {
    href: "/account",
    label: "My account",
    icon: UserRound,
    summary: "Your name, password and signed-in devices.",
    hidden: true,
  },
];

function matches(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav item a path belongs to: the longest matching href wins. */
export function findActiveItem(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.filter((item) => matches(pathname, item.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}

export function findItemByHref(href: string): NavItem | undefined {
  return [...ALL_NAV_ITEMS, ...QUICK_LINKS].find((item) => item.href === href);
}

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumbs from the nav tree: every nav item whose href prefixes the path,
 * then the remaining segment (e.g. a ticket number) as the current page.
 */
export function buildCrumbs(pathname: string): Crumb[] {
  const chain = ALL_NAV_ITEMS.filter(
    (item) => item.href !== "/" && matches(pathname, item.href),
  ).sort((a, b) => a.href.length - b.href.length);
  const crumbs: Crumb[] = chain.map((item) => ({ label: item.label, href: item.href }));
  const deepest = chain[chain.length - 1];

  if (pathname === "/") return [{ label: "Home" }];
  if (deepest && deepest.href !== pathname) {
    const rest = pathname
      .slice(deepest.href.length + 1)
      .split("/")
      .filter(Boolean);
    crumbs.push({ label: decodeURIComponent(rest[rest.length - 1] ?? "") });
  }
  if (!deepest) {
    const last = pathname.split("/").filter(Boolean).pop() ?? "";
    crumbs.push({ label: decodeURIComponent(last) });
  }
  // The last crumb is the current page and is not a link.
  const last = crumbs[crumbs.length - 1];
  crumbs[crumbs.length - 1] = { label: last.label };
  return crumbs;
}

/** Whether a user with `can` may see this entry. */
export function isVisible(item: NavItem, can: (permission: Permission) => boolean): boolean {
  if (!item.permission) return true;
  const required = Array.isArray(item.permission) ? item.permission : [item.permission];
  return required.some(can);
}
