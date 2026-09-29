import {
  Activity,
  Building2,
  Bell,
  Boxes,
  Clock,
  Database,
  FileUp,
  Flag,
  KeyRound,
  Layers,
  Mail,
  Map,
  MessageCircle,
  Palette,
  ScrollText,
  ShieldCheck,
  Tags,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Settings" };

interface Entry {
  icon: LucideIcon;
  label: string;
  description: string;
  /** Absent until the screen exists; the row then isn't a link. */
  href?: string;
  session?: number;
}

const GROUPS: { title: string; entries: Entry[] }[] = [
  {
    title: "People & access",
    entries: [
      {
        icon: Building2,
        label: "Company & demo data",
        description: "Company details; load or clear the demo company",
        href: "/settings/company",
      },
      {
        icon: Users,
        label: "Users & roles",
        description: "Invite people, set role and region",
        href: "/settings/users",
      },
      {
        icon: ShieldCheck,
        label: "Roles",
        description: "What each role can see and do",
        href: "/settings/roles",
      },
      {
        icon: Map,
        label: "Regions",
        description: "Pincodes and districts per service region",
        href: "/settings/regions",
      },
      {
        icon: Tags,
        label: "Skill tags",
        description: "Machine skills used to suggest engineers",
        href: "/settings/skills",
      },
      {
        icon: KeyRound,
        label: "Partner API keys",
        description: "Keys for partners who log tickets",
        href: "/settings/partner-keys",
      },
    ],
  },
  {
    title: "ERP & automation",
    entries: [
      {
        icon: Database,
        label: "ERP connections",
        description: "Connect ERPNext and test it",
        href: "/settings/erp",
      },
      {
        icon: Workflow,
        label: "Automations",
        description: "Syncs, SLA alerts, escalations, write-backs",
        href: "/settings/automations",
      },
      {
        icon: Activity,
        label: "System monitor",
        description: "Queues, jobs, ERP requests and webhooks",
        href: "/settings/system",
      },
      {
        icon: FileUp,
        label: "Bulk import",
        description: "Load customers or machines from CSV",
        href: "/settings/import",
      },
    ],
  },
  {
    title: "Service rules",
    entries: [
      {
        icon: Clock,
        label: "SLA policies",
        description: "Response and resolution targets",
        href: "/settings/service-rules?tab=sla",
      },
      {
        icon: Wrench,
        label: "Service types",
        description: "Breakdown, preventive, installation…",
        href: "/settings/service-rules?tab=service-types",
      },
      {
        icon: Flag,
        label: "Priorities",
        description: "Names and meaning of each priority",
        href: "/settings/service-rules?tab=priorities",
      },
      {
        icon: Layers,
        label: "Stage labels",
        description: "Display names for ticket stages",
        href: "/settings/service-rules?tab=stages",
      },
      {
        icon: Boxes,
        label: "Price lists & billing rates",
        description: "Spares prices, visit and travel charges",
        href: "/settings/service-rules?tab=billing",
      },
    ],
  },
  {
    title: "Notifications & records",
    entries: [
      {
        icon: Mail,
        label: "Email (SMTP)",
        description: "Server used to send email, templates and deliveries",
        href: "/settings/email",
      },
      {
        icon: Bell,
        label: "Notification templates",
        description: "Wording for the emails the app sends",
        href: "/settings/email?tab=templates",
      },
      {
        icon: MessageCircle,
        label: "WhatsApp",
        description: "Meta WhatsApp Business connection, channel toggles and deliveries",
        href: "/settings/whatsapp",
      },
      {
        icon: ScrollText,
        label: "Audit log",
        description: "Every change, who made it and when",
        href: "/settings/audit-log",
      },
      {
        icon: Palette,
        label: "Design system",
        description: "Colours, components and UI states",
        href: "/settings/design-system",
      },
    ],
  },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Changes here apply to everyone in your company." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {GROUPS.map((group) => (
          <Card key={group.title} aria-labelledby={`settings-${group.title}`}>
            <CardHeader titleId={`settings-${group.title}`} title={group.title} />
            <ul className="m-0 list-none p-0">
              {group.entries.map((entry) => {
                const Icon = entry.icon;
                const body = (
                  <>
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted"
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{entry.label}</span>
                      <span className="block text-[12.5px] text-muted">{entry.description}</span>
                    </span>
                    {entry.session && (
                      <span
                        className="shrink-0 pt-0.5 text-[11px] text-muted"
                        title={`Arrives in build session ${entry.session}`}
                      >
                        Soon
                      </span>
                    )}
                  </>
                );
                return (
                  <li key={entry.label} className="border-b border-line last:border-b-0">
                    {entry.href ? (
                      <Link
                        href={entry.href}
                        className="flex items-start gap-3 px-4 py-3 text-text no-underline hover:bg-surface-2"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
