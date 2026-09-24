import {
  Activity,
  Archive,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Cog,
  Database,
  Factory,
  FileText,
  Gauge,
  IndianRupee,
  LayoutDashboard,
  LayoutGrid,
  Palette,
  PlusCircle,
  ScrollText,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  TrendingUp,
  Truck,
  Users,
  Warehouse,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
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

// Role-based filtering arrives with auth in session 3.
export const NAV: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Home", icon: LayoutDashboard, summary: "Your overview for today." },
      {
        href: "/my-tickets",
        label: "My tickets",
        icon: ClipboardList,
        plannedSession: 9,
        summary: "An engineer's own tickets, availability and self-assign.",
      },
    ],
  },
  {
    label: "Service",
    items: [
      {
        href: "/tickets",
        label: "Tickets",
        icon: Ticket,
        summary: "Every service ticket, with filters and SLA status.",
      },
      {
        href: "/tickets/new",
        label: "Log a ticket",
        icon: PlusCircle,
        plannedSession: 8,
        summary: "Record a breakdown or service request with duplicate checks and routing.",
      },
      {
        href: "/customers",
        label: "Customers",
        icon: Building2,
        plannedSession: 7,
        summary: "Customers, sites and contacts, synced from your ERP.",
      },
      {
        href: "/equipment",
        label: "Equipment",
        icon: Wrench,
        plannedSession: 7,
        summary: "Machines installed at customer sites, with coverage and history.",
      },
      {
        href: "/amc",
        label: "AMC contracts",
        icon: ShieldCheck,
        plannedSession: 12,
        summary: "Maintenance contracts, planned visits and renewals.",
      },
      {
        href: "/items",
        label: "Spares & items",
        icon: Boxes,
        plannedSession: 7,
        summary: "Spare parts, prices and stock from your ERP.",
      },
    ],
  },
  {
    label: "Business dashboards",
    items: [
      {
        href: "/dashboards",
        label: "Overview",
        icon: LayoutGrid,
        plannedSession: 13,
        summary: "Company-wide figures across every dashboard.",
      },
      {
        href: "/dashboards/sales",
        label: "Sales",
        icon: TrendingUp,
        plannedSession: 13,
        summary: "Order booking, invoicing and open orders.",
      },
      {
        href: "/dashboards/finance",
        label: "Finance",
        icon: IndianRupee,
        plannedSession: 13,
        summary: "Receivables, ageing, collections and payables.",
      },
      {
        href: "/dashboards/manufacturing",
        label: "Manufacturing",
        icon: Factory,
        plannedSession: 13,
        summary: "Production against plan, work orders and scrap.",
      },
      {
        href: "/dashboards/procurement",
        label: "Procurement",
        icon: ShoppingCart,
        plannedSession: 13,
        summary: "Purchase orders, approvals and supplier lead times.",
      },
      {
        href: "/dashboards/stores",
        label: "Stores",
        icon: Warehouse,
        plannedSession: 13,
        summary: "Stock value, reorder levels and slow-moving items.",
      },
      {
        href: "/dashboards/fulfillment",
        label: "Fulfillment",
        icon: Archive,
        plannedSession: 13,
        summary: "On-time delivery and orders at risk.",
      },
      {
        href: "/dashboards/dispatch",
        label: "Dispatch",
        icon: Truck,
        plannedSession: 13,
        summary: "Dispatches, shipments in transit and e-way bills.",
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        href: "/reports",
        label: "Reports",
        icon: FileText,
        plannedSession: 14,
        summary: "Run and export service reports.",
      },
      {
        href: "/reports/kpi",
        label: "KPI matrix",
        icon: Gauge,
        plannedSession: 14,
        summary: "Service KPIs against targets, by region.",
      },
      {
        href: "/reports/schedules",
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
        label: "Settings",
        icon: Cog,
        summary: "Configure users, ERP connections, service rules and more.",
      },
      {
        href: "/settings/users",
        label: "Users & roles",
        icon: Users,
        plannedSession: 3,
        summary: "Invite people and set their role and region.",
      },
      {
        href: "/settings/erp",
        label: "ERP connections",
        icon: Database,
        plannedSession: 4,
        summary: "Connect ERPNext, test it, and choose what each connection is used for.",
      },
      {
        href: "/settings/automations",
        label: "Automations",
        icon: Workflow,
        plannedSession: 5,
        summary: "Switch SLA alerts, escalations, syncs and write-backs on or off.",
      },
      {
        href: "/settings/system",
        label: "System monitor",
        icon: Activity,
        plannedSession: 5,
        summary: "Queues, scheduled jobs, ERP requests and webhooks.",
      },
      {
        href: "/settings/audit-log",
        label: "Audit log",
        icon: ScrollText,
        plannedSession: 15,
        summary: "Every change, who made it and when.",
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
    icon: Users,
    plannedSession: 3,
    summary: "Your profile and password.",
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
