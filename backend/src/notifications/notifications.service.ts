import { Injectable, Logger } from '@nestjs/common';
import type { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';

export interface NotifyInput {
  userIds: (string | null | undefined)[];
  type: NotificationType;
  title: string;
  body?: string | null;
  ticketId?: string | null;
  /** The person who caused it never gets their own notification. */
  exceptUserId?: string | null;
}

const PAGE = 30;

/** In-app notifications (the bell). Only ever reads or writes the signed-in user's own rows. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Never throws: a failed notification must not undo the ticket change that caused it.
   * Only active users are notified.
   */
  async notify(input: NotifyInput, db: Prisma.TransactionClient = this.prisma): Promise<void> {
    const ids = [...new Set(input.userIds.filter((id): id is string => !!id))].filter(
      (id) => id !== input.exceptUserId,
    );
    if (!ids.length) return;
    try {
      const active = await db.user.findMany({
        where: { id: { in: ids }, status: 'ACTIVE' },
        select: { id: true },
      });
      await db.notification.createMany({
        data: active.map((u) => ({
          userId: u.id,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          ticketId: input.ticketId ?? null,
        })),
      });
    } catch (error) {
      this.logger.error(
        `Could not create ${input.type} notifications: ${(error as Error).message}`,
      );
    }
  }

  async list(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: PAGE,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          readAt: true,
          createdAt: true,
          ticket: { select: { id: true, number: true } },
        },
      }),
      this.unreadCount(userId),
    ]);
    return { items, unread };
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Marks the given notifications (or all) as read. Other users' ids are ignored. */
  async markRead(userId: string, ids?: string[]) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { marked: count, unread: await this.unreadCount(userId) };
  }
}
