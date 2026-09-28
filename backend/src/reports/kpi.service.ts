import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { visibleTo } from '../tickets/tickets.service';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../core/audit/audit.service';
import { resolveDateRange } from './catalog';

export type KpiKey =
  | 'sla-compliance'
  | 'avg-resolution-hours'
  | 'reopen-rate'
  | 'csat-average'
  | 'backlog-change'
  | 'visit-completion';

export const KPI_KEYS: KpiKey[] = [
  'sla-compliance',
  'avg-resolution-hours',
  'reopen-rate',
  'csat-average',
  'backlog-change',
  'visit-completion',
];

interface KpiMeta {
  label: string;
  unit: string;
  better: 'higher' | 'lower';
  defaultTarget: number;
}

export const KPI_META: Record<KpiKey, KpiMeta> = {
  'sla-compliance': { label: 'SLA compliance', unit: '%', better: 'higher', defaultTarget: 95 },
  'avg-resolution-hours': { label: 'Avg resolution time', unit: 'hrs', better: 'lower', defaultTarget: 48 },
  'reopen-rate': { label: 'Reopen rate', unit: '%', better: 'lower', defaultTarget: 5 },
  'csat-average': { label: 'CSAT average', unit: '/5', better: 'higher', defaultTarget: 4.5 },
  'backlog-change': { label: 'Backlog change', unit: '', better: 'lower', defaultTarget: 0 },
  'visit-completion': { label: 'Visit completion', unit: '%', better: 'higher', defaultTarget: 100 },
};

/** AppSetting key holding `{ [kpiKey]: { target: number, regions?: { [regionId]: number } } }`. */
export const KPI_TARGETS_KEY = 'kpi.targets';

export interface KpiTargetSet {
  target: number;
  regions?: Record<string, number>;
}

export type KpiTargets = Partial<Record<KpiKey, KpiTargetSet>>;

export interface KpiValue {
  key: KpiKey;
  label: string;
  value: number | null;
  target: number | null;
  unit: string;
  better: 'higher' | 'lower';
  /** Null when there is no data to judge. */
  met: boolean | null;
}

export interface KpiRegionRow {
  regionId: string | null;
  regionName: string;
  kpis: KpiValue[];
}

const CAP = 10_000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface RegionAcc {
  closed: number;
  compliant: number;
  reopened: number;
  resolutionHours: number[];
  created: number;
  csatSum: number;
  csatCount: number;
  visitsSubmitted: number;
  plannedVisits: number;
}

const emptyAcc = (): RegionAcc => ({
  closed: 0,
  compliant: 0,
  reopened: 0,
  resolutionHours: [],
  created: 0,
  csatSum: 0,
  csatCount: 0,
  visitsSubmitted: 0,
  plannedVisits: 0,
});

@Injectable()
export class KpiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getTargets(): Promise<KpiTargets> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: KPI_TARGETS_KEY } });
    const stored = (row?.value as KpiTargets | null) ?? {};
    const clean: KpiTargets = {};
    for (const key of KPI_KEYS) {
      const entry = stored[key];
      if (entry && typeof entry.target === 'number' && Number.isFinite(entry.target)) {
        clean[key] = { target: entry.target, regions: entry.regions ?? {} };
      }
    }
    return clean;
  }

  /** Replaces the target set (validated); audited. */
  async updateTargets(
    actor: AuthUser,
    targets: KpiTargets,
    client: ClientInfo,
  ): Promise<KpiTargets> {
    const clean: KpiTargets = {};
    for (const key of KPI_KEYS) {
      const entry = targets[key];
      if (entry === undefined) continue;
      if (typeof entry.target !== 'number' || !Number.isFinite(entry.target) || entry.target < 0) {
        throw new Error(`Target for ${KPI_META[key].label} must be a non-negative number.`);
      }
      const regions: Record<string, number> = {};
      for (const [regionId, v] of Object.entries(entry.regions ?? {})) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          throw new Error(`Regional target for ${KPI_META[key].label} must be a non-negative number.`);
        }
        regions[regionId] = v;
      }
      clean[key] = { target: entry.target, regions };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.appSetting.upsert({
        where: { key: KPI_TARGETS_KEY },
        create: { key: KPI_TARGETS_KEY, value: clean as Prisma.InputJsonValue },
        update: { value: clean as Prisma.InputJsonValue },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'reports.targets_updated',
          entityType: 'AppSetting',
          entityId: KPI_TARGETS_KEY,
          summary: `${actor.name} updated the KPI targets.`,
        },
        tx,
      );
    });
    return clean;
  }

  async matrix(
    user: Pick<AuthUser, 'id' | 'ticketScope' | 'regionId'>,
    params: Record<string, string | undefined>,
  ): Promise<{ from: string; to: string; rows: KpiRegionRow[] }> {
    const { from, to } = resolveDateRange(params);
    const scope = visibleTo(user);
    const regions = await this.prisma.region.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    const wanted =
      user.ticketScope === 'ALL'
        ? regions
        : regions.filter((r) => user.regionId && r.id === user.regionId);
    const accs = new Map<string, RegionAcc>();
    const acc = (regionId: string | null | undefined): RegionAcc | null => {
      if (!regionId) return null;
      let a = accs.get(regionId);
      if (!a) {
        a = emptyAcc();
        accs.set(regionId, a);
      }
      return a;
    };

    const [closed, created, csat, visits, planned] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { ...scope, closedAt: { gte: from, lte: to } },
        take: CAP,
        select: {
          regionId: true,
          responseBreached: true,
          resolutionBreached: true,
          reopenCount: true,
          createdAt: true,
          resolvedAt: true,
        },
      }),
      this.prisma.ticket.groupBy({
        by: ['regionId'],
        where: { ...scope, createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.csatResponse.findMany({
        where: { token: { ticket: scope }, createdAt: { gte: from, lte: to } },
        take: CAP,
        select: { rating: true, token: { select: { ticket: { select: { regionId: true } } } } },
      }),
      this.prisma.visit.findMany({
        where: { status: 'SUBMITTED', submittedAt: { gte: from, lte: to }, ticket: scope },
        take: CAP,
        select: { ticket: { select: { regionId: true } } },
      }),
      this.prisma.amcPlannedVisit.findMany({
        where: { plannedOn: { gte: from, lte: to }, status: { not: 'SKIPPED' } },
        take: CAP,
        select: { ticket: { select: { regionId: true } } },
      }),
    ]);

    for (const t of closed) {
      const a = acc(t.regionId);
      if (!a) continue;
      a.closed += 1;
      if (!t.responseBreached && !t.resolutionBreached) a.compliant += 1;
      if (t.reopenCount > 0) a.reopened += 1;
      if (t.resolvedAt) a.resolutionHours.push((t.resolvedAt.getTime() - t.createdAt.getTime()) / 3_600_000);
    }
    for (const g of created) {
      const a = acc(g.regionId);
      if (a) a.created += g._count._all;
    }
    for (const r of csat) {
      const a = acc(r.token.ticket.regionId);
      if (a) {
        a.csatSum += r.rating;
        a.csatCount += 1;
      }
    }
    for (const v of visits) {
      const a = acc(v.ticket.regionId);
      if (a) a.visitsSubmitted += 1;
    }
    for (const p of planned) {
      const a = acc(p.ticket?.regionId);
      if (a) a.plannedVisits += 1;
    }

    const targets = await this.getTargets();
    const targetFor = (key: KpiKey, regionId: string): number => {
      const entry = targets[key];
      const regional = entry?.regions?.[regionId];
      return typeof regional === 'number' ? regional : (entry?.target ?? KPI_META[key].defaultTarget);
    };

    const rows: KpiRegionRow[] = wanted.map((region) => {
      const a = accs.get(region.id) ?? emptyAcc();
      const value = (key: KpiKey, v: number | null): KpiValue => {
        const meta = KPI_META[key];
        const target = targetFor(key, region.id);
        return {
          key,
          label: meta.label,
          value: v,
          target,
          unit: meta.unit,
          better: meta.better,
          met: v === null ? null : meta.better === 'higher' ? v >= target : v <= target,
        };
      };
      return {
        regionId: region.id,
        regionName: region.name,
        kpis: [
          value('sla-compliance', a.closed ? round1((a.compliant / a.closed) * 100) : null),
          value(
            'avg-resolution-hours',
            a.resolutionHours.length
              ? round1(a.resolutionHours.reduce((s, h) => s + h, 0) / a.resolutionHours.length)
              : null,
          ),
          value('reopen-rate', a.closed ? round1((a.reopened / a.closed) * 100) : null),
          value('csat-average', a.csatCount ? round2(a.csatSum / a.csatCount) : null),
          value('backlog-change', a.created - (a.closed || 0)),
          value('visit-completion', a.plannedVisits ? round1((a.visitsSubmitted / a.plannedVisits) * 100) : null),
        ],
      };
    });

    if (user.ticketScope === 'ALL' && rows.length > 1) {
      rows.push(this.totalRow(rows));
    }
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), rows };
  }

  /** An "All regions" aggregate row; targets shown are the global ones. */
  private totalRow(rows: KpiRegionRow[]): KpiRegionRow {
    const kpis = KPI_KEYS.map((key, i) => {
      const vals = rows.map((r) => r.kpis[i].value).filter((v): v is number => v !== null);
      let value: number | null = null;
      if (vals.length) {
        value =
          key === 'avg-resolution-hours' || key === 'csat-average'
            ? round2(vals.reduce((s, v) => s + v, 0) / vals.length)
            : key === 'backlog-change'
              ? vals.reduce((s, v) => s + v, 0)
              : round1(vals.reduce((s, v) => s + v, 0) / vals.length);
      }
      const meta = KPI_META[key];
      const first = rows[0].kpis[i];
      return {
        key,
        label: meta.label,
        value,
        target: first.target,
        unit: meta.unit,
        better: meta.better,
        met: value === null || first.target === null ? null : meta.better === 'higher' ? value >= first.target : value <= first.target,
      } satisfies KpiValue;
    });
    return { regionId: null, regionName: 'All regions', kpis };
  }
}
