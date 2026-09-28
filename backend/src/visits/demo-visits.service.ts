import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { builtInRoleId } from '../auth/permissions';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { demoPhotoPng, demoSignaturePng } from '../demo/demo-png';
import { type AfterCommit, DemoService } from '../demo/demo.service';

/**
 * Fictional field visits for the demo company: draft visits on open tickets
 * (editable in the demo) and submitted visits with spares, photos and
 * signatures on closed tickets. Deterministic for a given date.
 */

const OPEN_STAGES = ['NEW', 'TRIAGED', 'ASSIGNED', 'ACCEPTED', 'ON_SITE', 'IN_PROGRESS'] as const;
const DONE_STAGES = ['RESOLVED', 'VERIFIED', 'CLOSED'] as const;

const WORK_DONE = [
  'Replaced the worn toggle plate and seat; ran the crusher 30 minutes under load. Output size back in spec.',
  'Mantle liner worn to 11 mm; replaced the mantle and bowl liner, reset the closed-side setting to 90 mm.',
  'Screen mesh torn on the top deck; replaced the 40 mm panels and re-tensioned the deck.',
  'Lube oil pressure alarm traced to a choked filter element; replaced the element and topped up the oil.',
  'Conveyor belt running off-centre; realigned the tail pulley and replaced two idlers.',
  'Burner failed to ignite after shutdown; replaced the fouled ignition electrode and cleaned the nozzle.',
];

const PHOTO_NAMES = ['fault-found.jpg', 'repair-done.jpg', 'nameplate.jpg'];
const SIGNATORIES = ['Site supervisor', 'Plant in-charge', 'Maintenance head'];

const dayMs = 24 * 60 * 60 * 1000;
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * dayMs);

@Injectable()
export class DemoVisitsService implements OnModuleInit {
  constructor(
    private readonly demo: DemoService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.demo.register({
      key: 'visits',
      count: () => this.prisma.visit.count({ where: { isDemo: true } }),
      load: (tx, now) => this.load(tx, now),
      clear: (tx) => this.clear(tx),
    });
  }

  private async clear(tx: Prisma.TransactionClient): Promise<AfterCommit> {
    const visits = await tx.visit.findMany({
      where: { isDemo: true },
      select: { signatureKey: true, photos: { select: { storageKey: true } } },
    });
    await tx.visit.deleteMany({ where: { isDemo: true } });
    return async () => {
      for (const visit of visits) {
        if (visit.signatureKey) await this.storage.remove(visit.signatureKey);
        for (const photo of visit.photos) await this.storage.remove(photo.storageKey);
      }
    };
  }

  private async load(tx: Prisma.TransactionClient, now: Date): Promise<void> {
    const [openTickets, doneTickets, users, items] = await Promise.all([
      tx.ticket.findMany({
        where: { isDemo: true, stage: { in: [...OPEN_STAGES] } },
        orderBy: { number: 'asc' },
        take: 4,
        select: { id: true, engineerId: true },
      }),
      tx.ticket.findMany({
        where: { isDemo: true, stage: { in: [...DONE_STAGES] } },
        orderBy: { number: 'asc' },
        take: 6,
        select: { id: true, engineerId: true },
      }),
      tx.user.findMany({ where: { isDemo: true, status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
      tx.item.findMany({
        where: { source: 'DEMO', active: true },
        orderBy: { itemCode: 'asc' },
        take: 12,
        select: { id: true },
      }),
    ]);
    const engineers = users.filter((u) => u.roleId === builtInRoleId('ENGINEER'));
    if (!openTickets.length || !doneTickets.length || !engineers.length || !items.length) return;
    const engineerFor = (ticket: { engineerId: string | null }) =>
      ticket.engineerId ?? engineers[0].id;

    // Drafts on open tickets: editable in the demo.
    for (const [i, ticket] of openTickets.entries()) {
      const engineerId = engineerFor(ticket);
      await tx.visit.create({
        data: {
          ticketId: ticket.id,
          visitNumber: 1,
          status: 'DRAFT',
          workDone: i === 0 ? WORK_DONE[i % WORK_DONE.length].slice(0, 40) : null,
          createdById: engineerId,
          isDemo: true,
          createdAt: daysAgo(now, 1 + i),
          ...(i < 2
            ? {
                spares: {
                  create: [
                    { itemId: items[i % items.length].id, quantity: 1 + (i % 2) },
                  ],
                },
              }
            : {}),
        },
      });
    }

    // Submitted visits on finished tickets: the full capture, read-only.
    for (const [i, ticket] of doneTickets.entries()) {
      const engineerId = engineerFor(ticket);
      const visit = await tx.visit.create({
        data: {
          ticketId: ticket.id,
          visitNumber: 1,
          status: 'SUBMITTED',
          workDone: WORK_DONE[i % WORK_DONE.length],
          submittedAt: daysAgo(now, 4 + i * 2),
          submittedById: engineerId,
          createdById: engineerId,
          isDemo: true,
          createdAt: daysAgo(now, 5 + i * 2),
          spares: {
            create: Array.from({ length: 1 + (i % 3) }, (_, s) => ({
              itemId: items[(i + s * 2) % items.length].id,
              quantity: 1 + ((i + s) % 3),
            })),
          },
        },
      });

      if (i === doneTickets.length - 1) {
        // One refusal, so the demo shows that path too.
        await tx.visit.update({
          where: { id: visit.id },
          data: {
            signatureRefused: true,
            refusalReason:
              'The customer was in a review meeting and asked us to email the report instead.',
          },
        });
      } else {
        const signature = demoSignaturePng(i + 1);
        const signatureKey = await this.storage.save(
          `demo/visits/${visit.id}`,
          'png',
          signature,
        );
        await tx.visit.update({
          where: { id: visit.id },
          data: { signatureKey, signatoryName: SIGNATORIES[i % SIGNATORIES.length] },
        });
      }

      const photoCount = 1 + (i % 2);
      for (let p = 0; p < photoCount; p++) {
        const bytes = demoPhotoPng(i * 3 + p + 1);
        const storageKey = await this.storage.save(`demo/visits/${visit.id}`, 'png', bytes);
        await tx.visitPhoto.create({
          data: {
            visitId: visit.id,
            fileName: PHOTO_NAMES[(i + p) % PHOTO_NAMES.length],
            mimeType: 'image/png',
            sizeBytes: bytes.length,
            storageKey,
            uploadedById: engineerId,
          },
        });
      }
    }
  }
}
