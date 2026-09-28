import { visibleTo } from '../tickets/tickets.service';
import { totalsFor } from '../quotations/quotations.service';
import type { AuthUser } from '../auth/auth.types';
import type { AppSettingsService } from '../demo/app-settings.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import type { CsvColumn } from './csv';

export type ReportKey =
  | 'ticket-volume-ageing'
  | 'sla-compliance'
  | 'engineer-performance'
  | 'quotation-pipeline'
  | 'csat-summary';

export const REPORT_KEYS: ReportKey[] = [
  'ticket-volume-ageing',
  'sla-compliance',
  'engineer-performance',
  'quotation-pipeline',
  'csat-summary',
];

/** On-demand runs are synchronous; the cap keeps the API responsive. */
export const ROW_CAP = 10_000;

export type ReportParamType = 'date' | 'select';

export interface ReportParamDef {
  key: string;
  label: string;
  type: ReportParamType;
  required?: boolean;
  options?: { value: string; label: string }[];
}

export type ReportParams = Record<string, string | undefined>;

export interface ReportContext {
  prisma: PrismaService;
  settings: AppSettingsService;
  user: Pick<AuthUser, 'id' | 'ticketScope' | 'regionId'>;
  params: ReportParams;
}

export interface ReportResult {
  columns: CsvColumn[];
  rows: Record<string, unknown>[];
  /** True when the query hit ROW_CAP and rows were cut off. */
  truncated: boolean;
  summary: Record<string, string | number>;
}

export interface ReportDefinition {
  key: ReportKey;
  label: string;
  description: string;
  params: ReportParamDef[];
  run(ctx: ReportContext): Promise<ReportResult>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

export interface DateRange {
  from: Date;
  to: Date;
}

/** Resolves from/to (default: last 30 days) and validates them. */
export function resolveDateRange(params: ReportParams): DateRange {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const fromStr = params.from?.trim() || iso(new Date(today.getTime() - 29 * 86_400_000));
  const toStr = params.to?.trim() || iso(today);
  if (!DATE_RE.test(fromStr) || !DATE_RE.test(toStr)) {
    throw new Error('Dates must be YYYY-MM-DD.');
  }
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to = new Date(`${toStr}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('Dates must be valid calendar dates.');
  }
  if (from > to) throw new Error('The from date must not be after the to date.');
  if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new Error(`Date ranges are limited to ${MAX_RANGE_DAYS} days.`);
  }
  return { from, to };
}

/** Checks that every declared param is present/valid; unknown params are rejected. */
export function validateReportParams(def: ReportDefinition, params: ReportParams): string | undefined {
  const known = new Set(def.params.map((p) => p.key));
  for (const key of Object.keys(params)) {
    if (!known.has(key)) return `Unknown parameter "${key}".`;
  }
  for (const param of def.params) {
    const value = params[param.key]?.trim();
    if (param.required && !value) return `"${param.label}" is required.`;
    if (value && param.options && !param.options.some((o) => o.value === value)) {
      return `"${param.label}" has an invalid value.`;
    }
  }
  try {
    resolveDateRange(params);
  } catch (error) {
    return (error as Error).message;
  }
  return undefined;
}

const DATE_PARAMS: ReportParamDef[] = [
  { key: 'from', label: 'From', type: 'date' },
  { key: 'to', label: 'To', type: 'date' },
];

const PRIORITY_OPTIONS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => ({
  value: p,
  label: p.charAt(0) + p.slice(1).toLowerCase(),
}));

function ageBucket(days: number): string {
  if (days <= 7) return '0–7 days';
  if (days <= 30) return '8–30 days';
  if (days <= 90) return '31–90 days';
  return '90+ days';
}

const yesNo = (v: boolean) => (v ? 'Yes' : 'No');
const isoDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');

async function regionOptions(prisma: PrismaService): Promise<{ value: string; label: string }[]> {
  const regions = await prisma.region.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return regions.map((r) => ({ value: r.id, label: r.name }));
}

const ticketVolumeAgeing: ReportDefinition = {
  key: 'ticket-volume-ageing',
  label: 'Ticket volume & ageing',
  description: 'Tickets logged in the period, with age and age bucket for open ones.',
  params: [
    ...DATE_PARAMS,
    { key: 'regionId', label: 'Region', type: 'select' },
    { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS },
  ],
  async run({ prisma, user, params }) {
    const { from, to } = resolveDateRange(params);
    const scope = visibleTo(user);
    const where = {
      ...scope,
      createdAt: { gte: from, lte: to },
      ...(params.regionId ? { regionId: params.regionId } : {}),
      ...(params.priority ? { priority: params.priority as never } : {}),
    };
    const tickets = await prisma.ticket.findMany({
      where,
      take: ROW_CAP + 1,
      orderBy: { createdAt: 'desc' },
      select: {
        number: true,
        title: true,
        stage: true,
        priority: true,
        createdAt: true,
        closedAt: true,
        cancelledAt: true,
        customer: { select: { name: true } },
        region: { select: { name: true } },
        engineer: { select: { name: true } },
      },
    });
    const truncated = tickets.length > ROW_CAP;
    const now = Date.now();
    const rows = tickets.slice(0, ROW_CAP).map((t) => {
      const open = !t.closedAt && !t.cancelledAt;
      const ageDays = Math.floor((now - t.createdAt.getTime()) / 86_400_000);
      return {
        ticket: t.number,
        title: t.title,
        customer: t.customer.name,
        region: t.region?.name ?? '',
        stage: t.stage,
        priority: t.priority,
        engineer: t.engineer?.name ?? '',
        created: isoDate(t.createdAt),
        ageDays: open ? ageDays : '',
        ageBucket: open ? ageBucket(ageDays) : '',
      };
    });
    return {
      columns: [
        { key: 'ticket', label: 'Ticket' },
        { key: 'title', label: 'Title' },
        { key: 'customer', label: 'Customer' },
        { key: 'region', label: 'Region' },
        { key: 'stage', label: 'Stage' },
        { key: 'priority', label: 'Priority' },
        { key: 'engineer', label: 'Engineer' },
        { key: 'created', label: 'Created' },
        { key: 'ageDays', label: 'Age (days)' },
        { key: 'ageBucket', label: 'Age bucket' },
      ],
      rows,
      truncated,
      summary: {
        tickets: rows.length,
        open: rows.filter((r) => r.ageDays !== '').length,
      },
    };
  },
};

const CLOSED_STAGES = ['CLOSED', 'CANCELLED'] as const;

const slaCompliance: ReportDefinition = {
  key: 'sla-compliance',
  label: 'SLA compliance',
  description: 'Response and resolution SLA outcomes for tickets closed in the period.',
  params: [...DATE_PARAMS, { key: 'regionId', label: 'Region', type: 'select' }],
  async run({ prisma, user, params }) {
    const { from, to } = resolveDateRange(params);
    const scope = visibleTo(user);
    const tickets = await prisma.ticket.findMany({
      where: {
        ...scope,
        stage: { in: [...CLOSED_STAGES] as never[] },
        closedAt: { gte: from, lte: to },
        ...(params.regionId ? { regionId: params.regionId } : {}),
      },
      take: ROW_CAP + 1,
      orderBy: { closedAt: 'desc' },
      select: {
        number: true,
        respondedAt: true,
        responseBreached: true,
        resolvedAt: true,
        resolutionBreached: true,
        customer: { select: { name: true } },
      },
    });
    const truncated = tickets.length > ROW_CAP;
    const rows = tickets.slice(0, ROW_CAP).map((t) => ({
      ticket: t.number,
      customer: t.customer.name,
      responded: isoDate(t.respondedAt),
      responseBreached: yesNo(t.responseBreached),
      resolved: isoDate(t.resolvedAt),
      resolutionBreached: yesNo(t.resolutionBreached),
      compliant: yesNo(!t.responseBreached && !t.resolutionBreached),
    }));
    const pct = (n: number) => (rows.length ? Math.round((n / rows.length) * 1000) / 10 : 0);
    return {
      columns: [
        { key: 'ticket', label: 'Ticket' },
        { key: 'customer', label: 'Customer' },
        { key: 'responded', label: 'Responded' },
        { key: 'responseBreached', label: 'Response breached' },
        { key: 'resolved', label: 'Resolved' },
        { key: 'resolutionBreached', label: 'Resolution breached' },
        { key: 'compliant', label: 'Compliant' },
      ],
      rows,
      truncated,
      summary: {
        tickets: rows.length,
        responseCompliancePct: pct(rows.filter((r) => r.responseBreached === 'No').length),
        resolutionCompliancePct: pct(rows.filter((r) => r.resolutionBreached === 'No').length),
        overallCompliancePct: pct(rows.filter((r) => r.compliant === 'Yes').length),
      },
    };
  },
};

const engineerPerformance: ReportDefinition = {
  key: 'engineer-performance',
  label: 'Engineer performance',
  description: 'Workload, resolution speed and SLA outcomes per engineer for the period.',
  params: [...DATE_PARAMS, { key: 'regionId', label: 'Region', type: 'select' }],
  async run({ prisma, user, params }) {
    const { from, to } = resolveDateRange(params);
    const scope = visibleTo(user);
    const tickets = await prisma.ticket.findMany({
      where: {
        ...scope,
        createdAt: { gte: from, lte: to },
        engineerId: { not: null },
        ...(params.regionId ? { regionId: params.regionId } : {}),
      },
      take: ROW_CAP + 1,
      select: {
        engineerId: true,
        engineer: { select: { name: true } },
        createdAt: true,
        resolvedAt: true,
        reopenCount: true,
        responseBreached: true,
        resolutionBreached: true,
      },
    });
    const truncated = tickets.length > ROW_CAP;
    const byEngineer = new Map<string, { name: string; assigned: number; resolved: number; hours: number[]; reopened: number; breached: number }>();
    for (const t of tickets.slice(0, ROW_CAP)) {
      const id = t.engineerId!;
      let agg = byEngineer.get(id);
      if (!agg) {
        agg = { name: t.engineer?.name ?? 'Unknown', assigned: 0, resolved: 0, hours: [], reopened: 0, breached: 0 };
        byEngineer.set(id, agg);
      }
      agg.assigned += 1;
      if (t.resolvedAt) {
        agg.resolved += 1;
        agg.hours.push((t.resolvedAt.getTime() - t.createdAt.getTime()) / 3_600_000);
      }
      if (t.reopenCount > 0) agg.reopened += 1;
      if (t.responseBreached || t.resolutionBreached) agg.breached += 1;
    }
    const rows = [...byEngineer.values()]
      .map((a) => ({
        engineer: a.name,
        assigned: a.assigned,
        resolved: a.resolved,
        avgResolutionHours: a.hours.length ? Math.round((a.hours.reduce((s, h) => s + h, 0) / a.hours.length) * 10) / 10 : '',
        reopened: a.reopened,
        slaCompliancePct: a.assigned ? Math.round(((a.assigned - a.breached) / a.assigned) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.assigned - a.assigned);
    return {
      columns: [
        { key: 'engineer', label: 'Engineer' },
        { key: 'assigned', label: 'Assigned' },
        { key: 'resolved', label: 'Resolved' },
        { key: 'avgResolutionHours', label: 'Avg resolution (hrs)' },
        { key: 'reopened', label: 'Reopened' },
        { key: 'slaCompliancePct', label: 'SLA compliance %' },
      ],
      rows,
      truncated,
      summary: { engineers: rows.length, assigned: rows.reduce((s, r) => s + (r.assigned as number), 0) },
    };
  },
};

const quotationPipeline: ReportDefinition = {
  key: 'quotation-pipeline',
  label: 'Quotation pipeline',
  description: 'Quotations created in the period, with values and pipeline status.',
  params: [...DATE_PARAMS],
  async run({ prisma, settings, user, params }) {
    const { from, to } = resolveDateRange(params);
    const scope = visibleTo(user);
    const company = await settings.company();
    const quotations = await prisma.quotation.findMany({
      where: { ticket: scope, createdAt: { gte: from, lte: to } },
      take: ROW_CAP + 1,
      orderBy: { createdAt: 'desc' },
      select: {
        number: true,
        status: true,
        discountPercent: true,
        sentAt: true,
        validUntil: true,
        ticket: { select: { number: true, customer: { select: { name: true } } } },
        lines: { select: { quantity: true, rate: true } },
      },
    });
    const truncated = quotations.length > ROW_CAP;
    const rows = quotations.slice(0, ROW_CAP).map((q) => {
      const totals = totalsFor(
        q.lines.map((l) => ({ quantity: l.quantity, rate: l.rate })),
        q.discountPercent,
        company.gstRatePercent,
        company.currency,
      );
      return {
        quotation: q.number,
        ticket: q.ticket.number,
        customer: q.ticket.customer.name,
        status: q.status,
        lines: totals.lineCount,
        subtotal: totals.subtotal,
        total: totals.total,
        currency: company.currency,
        sent: isoDate(q.sentAt),
        validUntil: isoDate(q.validUntil),
      };
    });
    const byStatus: Record<string, number> = {};
    let poValue = 0;
    for (const r of rows) {
      byStatus[r.status as string] = (byStatus[r.status as string] ?? 0) + 1;
      if (r.status === 'PO_RECEIVED') poValue += Number(r.total);
    }
    return {
      columns: [
        { key: 'quotation', label: 'Quotation' },
        { key: 'ticket', label: 'Ticket' },
        { key: 'customer', label: 'Customer' },
        { key: 'status', label: 'Status' },
        { key: 'lines', label: 'Lines' },
        { key: 'subtotal', label: 'Subtotal' },
        { key: 'total', label: 'Total' },
        { key: 'currency', label: 'Currency' },
        { key: 'sent', label: 'Sent' },
        { key: 'validUntil', label: 'Valid until' },
      ],
      rows,
      truncated,
      summary: {
        quotations: rows.length,
        poReceived: byStatus['PO_RECEIVED'] ?? 0,
        poValue: Math.round(poValue * 100) / 100,
      },
    };
  },
};

const csatSummary: ReportDefinition = {
  key: 'csat-summary',
  label: 'CSAT summary',
  description: 'Customer satisfaction ratings received in the period.',
  params: [...DATE_PARAMS],
  async run({ prisma, user, params }) {
    const { from, to } = resolveDateRange(params);
    const scope = visibleTo(user);
    const responses = await prisma.csatResponse.findMany({
      where: { token: { ticket: scope }, createdAt: { gte: from, lte: to } },
      take: ROW_CAP + 1,
      orderBy: { createdAt: 'desc' },
      select: {
        rating: true,
        comment: true,
        createdAt: true,
        token: { select: { ticket: { select: { number: true } } } },
      },
    });
    const truncated = responses.length > ROW_CAP;
    const rows = responses.slice(0, ROW_CAP).map((r) => ({
      ticket: r.token.ticket.number,
      rating: r.rating,
      comment: r.comment ?? '',
      received: isoDate(r.createdAt),
    }));
    const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const r of rows) dist[String(r.rating)] += 1;
    const avg = rows.length ? rows.reduce((s, r) => s + (r.rating as number), 0) / rows.length : 0;
    return {
      columns: [
        { key: 'ticket', label: 'Ticket' },
        { key: 'rating', label: 'Rating (1–5)' },
        { key: 'comment', label: 'Comment' },
        { key: 'received', label: 'Received' },
      ],
      rows,
      truncated,
      summary: {
        responses: rows.length,
        average: Math.round(avg * 100) / 100,
        ...Object.fromEntries(Object.entries(dist).map(([k, v]) => [`rated${k}`, v])),
      },
    };
  },
};

/** The v1 catalog. Adding a report is a code change with tests. */
export const REPORTS: Record<ReportKey, ReportDefinition> = {
  'ticket-volume-ageing': ticketVolumeAgeing,
  'sla-compliance': slaCompliance,
  'engineer-performance': engineerPerformance,
  'quotation-pipeline': quotationPipeline,
  'csat-summary': csatSummary,
};

export function reportDefinition(key: string): ReportDefinition | undefined {
  return (REPORTS as Record<string, ReportDefinition>)[key];
}

/** Enriches select-type params with live options (regions). Called per request. */
export async function describeCatalog(prisma: PrismaService) {
  const regions = await regionOptions(prisma);
  return REPORT_KEYS.map((key) => {
    const def = REPORTS[key];
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      params: def.params.map((p) =>
        p.key === 'regionId' ? { ...p, options: regions } : p,
      ),
    };
  });
}
