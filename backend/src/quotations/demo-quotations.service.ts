import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma, QuotationStatus } from '@prisma/client';
import { builtInRoleId } from '../auth/permissions';
import { PrismaService } from '../core/prisma/prisma.service';
import { AppSettingsService } from '../demo/app-settings.service';
import { DemoService } from '../demo/demo.service';

/**
 * Fictional quotations for the demo company, on chargeable demo tickets: one
 * of every status (draft, sent, PO received, revised, cancelled, expired) so
 * the whole quote-to-PO flow is demoable. Deterministic for a given date.
 */

const dayMs = 24 * 60 * 60 * 1000;
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * dayMs);
const daysAhead = (now: Date, days: number) => new Date(now.getTime() + days * dayMs);

interface DemoLine {
  itemIndex: number;
  quantity: number;
}

interface DemoQuotationPlan {
  lines: DemoLine[];
  status: QuotationStatus;
  /** Days ago it was created. */
  createdDaysAgo: number;
  /** Days ago it was sent (SENT and beyond). */
  sentDaysAgo?: number;
  /** Valid-until, as an offset in days from today (negative = lapsed). */
  validOffsetDays: number;
  discountPercent?: number;
  notes?: string;
  poNumber?: string;
  poDaysAgo?: number;
  /** When set, this quotation revises the plan at that index. */
  revisesPlan?: number;
}

const PLANS: DemoQuotationPlan[] = [
  {
    lines: [
      { itemIndex: 0, quantity: 2 },
      { itemIndex: 3, quantity: 1 },
    ],
    status: 'DRAFT',
    createdDaysAgo: 2,
    validOffsetDays: 30,
    discountPercent: 5,
    notes: 'Includes two days of commissioning labour. Rates valid for 30 days.',
  },
  {
    lines: [
      { itemIndex: 1, quantity: 1 },
      { itemIndex: 4, quantity: 4 },
      { itemIndex: 6, quantity: 2 },
    ],
    status: 'SENT',
    createdDaysAgo: 8,
    sentDaysAgo: 5,
    validOffsetDays: 25,
    notes: 'GST extra as applicable. Delivery in 10 working days.',
  },
  {
    lines: [
      { itemIndex: 2, quantity: 1 },
      { itemIndex: 5, quantity: 2 },
    ],
    status: 'PO_RECEIVED',
    createdDaysAgo: 25,
    sentDaysAgo: 20,
    validOffsetDays: 35,
    poNumber: 'PO-26-1847',
    poDaysAgo: 11,
  },
  {
    lines: [
      { itemIndex: 0, quantity: 2 },
      { itemIndex: 7, quantity: 1 },
    ],
    status: 'REVISED',
    createdDaysAgo: 30,
    sentDaysAgo: 25,
    validOffsetDays: 30,
    notes: 'Superseded: customer asked for the premium liner instead.',
  },
  {
    lines: [
      { itemIndex: 0, quantity: 2 },
      { itemIndex: 7, quantity: 1 },
    ],
    status: 'SENT',
    createdDaysAgo: 3,
    sentDaysAgo: 2,
    validOffsetDays: 28,
    revisesPlan: 3,
    notes: 'Revision with the premium liner, as requested.',
  },
  {
    lines: [{ itemIndex: 8, quantity: 3 }],
    status: 'CANCELLED',
    createdDaysAgo: 15,
    sentDaysAgo: 14,
    validOffsetDays: 16,
    notes: 'Withdrawn: the customer deferred the overhaul to next quarter.',
  },
  {
    lines: [
      { itemIndex: 1, quantity: 2 },
      { itemIndex: 9, quantity: 1 },
    ],
    status: 'EXPIRED',
    createdDaysAgo: 45,
    sentDaysAgo: 40,
    validOffsetDays: -10,
  },
];

@Injectable()
export class DemoQuotationsService implements OnModuleInit {
  constructor(
    private readonly demo: DemoService,
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
  ) {}

  onModuleInit(): void {
    this.demo.register({
      key: 'quotations',
      count: () => this.prisma.quotation.count({ where: { isDemo: true } }),
      load: (tx, now) => this.load(tx, now),
      clear: (tx) => this.clear(tx),
    });
  }

  private async clear(tx: Prisma.TransactionClient): Promise<void> {
    // Lines cascade. The yearly counter is left alone so numbers stay unique
    // across a reload.
    await tx.quotation.deleteMany({ where: { isDemo: true } });
  }

  /** Next QT-26-000123 number, inside the caller's transaction. */
  private async nextNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
    const { timezone } = await this.settings.company();
    const year = Number(
      new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric' }).format(now),
    );
    const counter = await tx.quotationCounter.upsert({
      where: { year },
      create: { year, last: 1 },
      update: { last: { increment: 1 } },
    });
    return `QT-${String(year % 100).padStart(2, '0')}-${String(counter.last).padStart(6, '0')}`;
  }

  private async load(tx: Prisma.TransactionClient, now: Date): Promise<void> {
    const [tickets, items, prices, users] = await Promise.all([
      tx.ticket.findMany({
        where: { isDemo: true, coverage: 'CHARGEABLE', stage: { not: 'CANCELLED' } },
        orderBy: { number: 'asc' },
        take: PLANS.length,
        select: { id: true },
      }),
      tx.item.findMany({
        where: { source: 'DEMO', active: true },
        orderBy: { itemCode: 'asc' },
        take: 10,
        select: { id: true, itemCode: true },
      }),
      tx.itemPrice.findMany({
        where: { source: 'DEMO', priceList: 'Standard 2026' },
        select: { itemCode: true, rate: true },
      }),
      tx.user.findMany({ where: { isDemo: true, status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
    ]);
    if (tickets.length < PLANS.length || items.length < 10 || !users.length) return;
    const support =
      users.find((u) => u.roleId === builtInRoleId('CS_SUPPORT')) ?? users[0];
    const rateOf = (itemCode: string) =>
      prices.find((p) => p.itemCode === itemCode)?.rate ?? 1000;

    const createdIds: string[] = [];
    for (const [i, plan] of PLANS.entries()) {
      const number = await this.nextNumber(tx, now);
      const quotation = await tx.quotation.create({
        data: {
          ticketId: tickets[i].id,
          number,
          status: plan.status,
          discountPercent: plan.discountPercent ?? null,
          validUntil: plan.validOffsetDays >= 0
            ? daysAhead(now, plan.validOffsetDays)
            : daysAgo(now, -plan.validOffsetDays),
          notes: plan.notes ?? null,
          sentAt: plan.sentDaysAgo != null ? daysAgo(now, plan.sentDaysAgo) : null,
          sentById: plan.sentDaysAgo != null ? support.id : null,
          poNumber: plan.poNumber ?? null,
          poDate: plan.poDaysAgo != null ? daysAgo(now, plan.poDaysAgo + 1) : null,
          poReceivedAt: plan.poDaysAgo != null ? daysAgo(now, plan.poDaysAgo) : null,
          revisesId: plan.revisesPlan != null ? createdIds[plan.revisesPlan] : null,
          createdById: support.id,
          isDemo: true,
          createdAt: daysAgo(now, plan.createdDaysAgo),
          lines: {
            create: plan.lines.map((line) => {
              const item = items[line.itemIndex % items.length];
              return {
                itemId: item.id,
                quantity: line.quantity,
                rate: rateOf(item.itemCode),
              };
            }),
          },
        },
        select: { id: true },
      });
      createdIds.push(quotation.id);
    }
  }
}
