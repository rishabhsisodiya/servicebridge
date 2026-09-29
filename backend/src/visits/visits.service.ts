import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { AuditService } from '../core/audit/audit.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { detectFileType, StorageService } from '../core/storage/storage.service';
import { VISIT_STAGES } from '../tickets/engineers.service';
import { TicketNotifier } from '../tickets/ticket-notifier';
import type { UploadedFileLike } from '../tickets/ticket-attachments.service';
import { TicketsService } from '../tickets/tickets.service';
import { WritebacksService } from '../erp/writebacks/writebacks.service';
import {
  AddSpareDto,
  CreateVisitDto,
  RefuseSignatureDto,
  UpdateSpareDto,
  UpdateVisitDto,
} from './dto';
import { VisitEvents } from './visit-events';

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_VISIT = 10;
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

const visitDetail = {
  id: true,
  ticketId: true,
  visitNumber: true,
  status: true,
  workDone: true,
  signatoryName: true,
  signatureKey: true,
  signatureRefused: true,
  refusalReason: true,
  submittedAt: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const;

type TicketRef = {
  id: string;
  number: string;
  title: string;
  engineerId: string | null;
  areaManagerId: string | null;
};

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly notifier: TicketNotifier,
    private readonly events: VisitEvents,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly writebacks: WritebacksService,
  ) {}

  /** The ticket, or 404 when it doesn't exist or the user can't see it. */
  private async ticketFor(
    user: AuthUser,
    ticketId: string,
  ): Promise<TicketRef & { stage: string }> {
    const id = await this.tickets.visibleId(user, ticketId);
    return this.prisma.ticket.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        number: true,
        title: true,
        stage: true,
        engineerId: true,
        areaManagerId: true,
      },
    });
  }

  /** Only the assigned engineer or a manager (tickets.assign) works on visits. */
  private assertCanWork(user: AuthUser, ticket: { engineerId: string | null }): void {
    if (ticket.engineerId === user.id || can(user, 'tickets.assign')) return;
    throw new AppException(
      'FORBIDDEN',
      'Only the assigned engineer or a manager can log visits.',
      HttpStatus.FORBIDDEN,
    );
  }

  /** A visit the user may change: visible ticket, draft status, worked by them. */
  private async loadDraft(user: AuthUser, id: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      include: {
        ticket: {
          select: {
            id: true,
            number: true,
            title: true,
            engineerId: true,
            areaManagerId: true,
          },
        },
      },
    });
    if (!visit) {
      throw new AppException('VISIT_NOT_FOUND', 'That visit no longer exists.', HttpStatus.NOT_FOUND);
    }
    await this.tickets.visibleId(user, visit.ticketId);
    this.assertCanWork(user, visit.ticket);
    if (visit.status !== 'DRAFT') {
      throw new AppException(
        'VISIT_NOT_DRAFT',
        'Submitted visits are locked.',
        HttpStatus.CONFLICT,
      );
    }
    return visit;
  }

  async create(user: AuthUser, dto: CreateVisitDto) {
    const ticket = await this.ticketFor(user, dto.ticketId);
    this.assertCanWork(user, ticket);
    if (!VISIT_STAGES.includes(ticket.stage as (typeof VISIT_STAGES)[number])) {
      throw new AppException(
        'VISIT_STAGE_NOT_ALLOWED',
        'Visits can only be logged while the ticket is on site or in progress.',
        HttpStatus.CONFLICT,
      );
    }
    const visit = await this.prisma.$transaction(async (tx) => {
      // One-draft-per-ticket can't be a partial unique index in Prisma, so a
      // transaction-scoped Postgres advisory lock (per ticket) serializes
      // concurrent creates: the second create blocks until the first commits,
      // then sees the draft via the check below. Released at tx end.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('visit-draft:' || ${ticket.id})::bigint)`;
      const open = await tx.visit.findFirst({
        where: { ticketId: ticket.id, status: 'DRAFT' },
        select: { id: true },
      });
      if (open) {
        throw new AppException(
          'VISIT_DRAFT_EXISTS',
          'Finish or delete the open visit before starting another.',
          HttpStatus.CONFLICT,
        );
      }
      const last = await tx.visit.findFirst({
        where: { ticketId: ticket.id },
        orderBy: { visitNumber: 'desc' },
        select: { visitNumber: true },
      });
      const created = await tx.visit.create({
        data: {
          ticketId: ticket.id,
          visitNumber: (last?.visitNumber ?? 0) + 1,
          createdById: user.id,
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'visit.create',
          entityType: 'Visit',
          entityId: created.id,
          summary: `Started visit ${created.visitNumber} on ticket ${ticket.number}`,
        },
        tx,
      );
      return created;
    });
    const { signatureKey, ...rest } = visit;
    return { ...rest, hasSignature: !!signatureKey };
  }

  async listForTicket(user: AuthUser, ticketId: string) {
    const id = await this.tickets.visibleId(user, ticketId);
    const visits = await this.prisma.visit.findMany({
      where: { ticketId: id },
      orderBy: { visitNumber: 'asc' },
      select: {
        ...visitDetail,
        submittedBy: { select: { name: true } },
        _count: { select: { spares: true, photos: true } },
      },
    });
    return visits.map((v) => {
      const { signatureKey, ...rest } = v;
      return { ...rest, hasSignature: !!signatureKey };
    });
  }

  async get(user: AuthUser, id: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      include: {
        spares: {
          include: { item: { select: { id: true, itemCode: true, name: true, uom: true } } },
          orderBy: { createdAt: 'asc' },
        },
        photos: { orderBy: { createdAt: 'asc' } },
        submittedBy: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!visit) {
      throw new AppException('VISIT_NOT_FOUND', 'That visit no longer exists.', HttpStatus.NOT_FOUND);
    }
    await this.tickets.visibleId(user, visit.ticketId);
    const { signatureKey, ...rest } = visit;
    return { ...rest, hasSignature: !!signatureKey };
  }

  async update(user: AuthUser, id: string, dto: UpdateVisitDto) {
    const visit = await this.loadDraft(user, id);
    if (visit.version !== dto.version) {
      throw new AppException(
        'VERSION_CONFLICT',
        'This visit changed since you opened it. Reload and try again.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.visit.update({
        where: { id },
        data: {
          workDone: dto.workDone ?? undefined,
          signatoryName: dto.signatoryName ?? undefined,
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'visit.update',
          entityType: 'Visit',
          entityId: id,
          summary: `Edited visit ${visit.visitNumber} on ticket ${visit.ticket.number}`,
        },
        tx,
      );
      return next;
    });
    const { signatureKey, ...rest } = updated;
    return { ...rest, hasSignature: !!signatureKey };
  }

  async remove(user: AuthUser, id: string) {
    const visit = await this.loadDraft(user, id);
    const photos = await this.prisma.visitPhoto.findMany({
      where: { visitId: id },
      select: { storageKey: true },
    });
    const keys = [
      ...photos.map((p) => p.storageKey),
      ...(visit.signatureKey ? [visit.signatureKey] : []),
    ];
    await this.prisma.$transaction(async (tx) => {
      // Spares and photos cascade.
      await tx.visit.delete({ where: { id } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'visit.delete',
          entityType: 'Visit',
          entityId: id,
          summary: `Deleted draft visit ${visit.visitNumber} on ticket ${visit.ticket.number}`,
        },
        tx,
      );
    });
    for (const key of keys) await this.storage.remove(key);
  }

  async addSpare(user: AuthUser, id: string, dto: AddSpareDto) {
    const visit = await this.loadDraft(user, id);
    const item = await this.prisma.item.findFirst({
      where: { id: dto.itemId, active: true },
      select: { id: true, itemCode: true, name: true },
    });
    if (!item) {
      throw new AppException('ITEM_NOT_FOUND', 'That item does not exist.', HttpStatus.NOT_FOUND);
    }
    // Warn-only: stock data can be stale or missing, so it never blocks.
    const levels = await this.prisma.stockLevel.findMany({
      where: { itemCode: item.itemCode },
      select: { actualQty: true },
    });
    const available = levels.reduce((sum, l) => sum + Number(l.actualQty), 0);
    const stockWarning = levels.length > 0 && available < dto.quantity;
    const spare = await this.prisma.$transaction(async (tx) => {
      const created = await tx.visitSpare.create({
        data: { visitId: id, itemId: item.id, quantity: dto.quantity },
        include: { item: { select: { id: true, itemCode: true, name: true, uom: true } } },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'visit.spare.add',
          entityType: 'Visit',
          entityId: id,
          summary: `Added ${dto.quantity} × ${item.name} to visit ${visit.visitNumber} on ticket ${visit.ticket.number}`,
        },
        tx,
      );
      return created;
    });
    return { ...spare, stockWarning, availableStock: available };
  }

  async updateSpare(user: AuthUser, id: string, spareId: string, dto: UpdateSpareDto) {
    const visit = await this.loadDraft(user, id);
    const spare = await this.prisma.visitSpare.findFirst({
      where: { id: spareId, visitId: id },
      include: { item: { select: { name: true } } },
    });
    if (!spare) {
      throw new AppException('SPARE_NOT_FOUND', 'That spare line no longer exists.', HttpStatus.NOT_FOUND);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.visitSpare.update({
        where: { id: spareId },
        data: { quantity: dto.quantity },
        include: { item: { select: { id: true, itemCode: true, name: true, uom: true } } },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'visit.spare.update',
          entityType: 'Visit',
          entityId: id,
          summary: `Set ${spare.item.name} to ${dto.quantity} on visit ${visit.visitNumber} (${visit.ticket.number})`,
          changes: { quantity: { from: spare.quantity, to: dto.quantity } },
        },
        tx,
      );
      return updated;
    });
  }

  async removeSpare(user: AuthUser, id: string, spareId: string) {
    const visit = await this.loadDraft(user, id);
    const spare = await this.prisma.visitSpare.findFirst({
      where: { id: spareId, visitId: id },
      include: { item: { select: { name: true } } },
    });
    if (!spare) {
      throw new AppException('SPARE_NOT_FOUND', 'That spare line no longer exists.', HttpStatus.NOT_FOUND);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.visitSpare.delete({ where: { id: spareId } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'visit.spare.remove',
          entityType: 'Visit',
          entityId: id,
          summary: `Removed ${spare.item.name} from visit ${visit.visitNumber} (${visit.ticket.number})`,
        },
        tx,
      );
    });
  }

  async addPhoto(user: AuthUser, id: string, file: UploadedFileLike | undefined) {
    const visit = await this.loadDraft(user, id);
    if (!file?.buffer?.length) {
      throw new AppException('FILE_MISSING', 'Choose a photo to upload.', HttpStatus.BAD_REQUEST);
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new AppException(
        'FILE_TOO_LARGE',
        'Photos can be up to 10 MB.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const type = detectFileType(file.buffer);
    if (!type || !type.mime.startsWith('image/')) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        'Upload a photo (JPEG, PNG or WebP).',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const count = await this.prisma.visitPhoto.count({ where: { visitId: id } });
    if (count >= MAX_PHOTOS_PER_VISIT) {
      throw new AppException(
        'TOO_MANY_FILES',
        `A visit can have up to ${MAX_PHOTOS_PER_VISIT} photos.`,
        HttpStatus.CONFLICT,
      );
    }
    const storageKey = await this.storage.save(`visits/${id}`, type.ext, file.buffer);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const photo = await tx.visitPhoto.create({
          data: {
            visitId: id,
            fileName: cleanFileName(file.originalname, type.ext),
            mimeType: type.mime,
            sizeBytes: file.size,
            storageKey,
            uploadedById: user.id,
          },
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: 'visit.photo.add',
            entityType: 'Visit',
            entityId: id,
            summary: `Added a photo to visit ${visit.visitNumber} (${visit.ticket.number})`,
          },
          tx,
        );
        return photo;
      });
    } catch (error) {
      await this.storage.remove(storageKey);
      throw error;
    }
  }

  async removePhoto(user: AuthUser, id: string, photoId: string) {
    const visit = await this.loadDraft(user, id);
    const photo = await this.prisma.visitPhoto.findFirst({ where: { id: photoId, visitId: id } });
    if (!photo) {
      throw new AppException('FILE_NOT_FOUND', 'That photo no longer exists.', HttpStatus.NOT_FOUND);
    }
    if (photo.uploadedById !== user.id && !can(user, 'tickets.assign')) {
      throw new AppException(
        'FORBIDDEN',
        'Only the person who added a photo, or a manager, can remove it.',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.visitPhoto.delete({ where: { id: photoId } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'visit.photo.remove',
          entityType: 'Visit',
          entityId: id,
          summary: `Removed photo ${photo.fileName} from visit ${visit.visitNumber} (${visit.ticket.number})`,
        },
        tx,
      );
    });
    await this.storage.remove(photo.storageKey);
  }

  async openPhoto(user: AuthUser, id: string, photoId: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      select: { ticketId: true },
    });
    if (!visit) {
      throw new AppException('VISIT_NOT_FOUND', 'That visit no longer exists.', HttpStatus.NOT_FOUND);
    }
    await this.tickets.visibleId(user, visit.ticketId);
    const photo = await this.prisma.visitPhoto.findFirst({ where: { id: photoId, visitId: id } });
    if (!photo) {
      throw new AppException('FILE_NOT_FOUND', 'That photo no longer exists.', HttpStatus.NOT_FOUND);
    }
    return { photo, stream: this.storage.read(photo.storageKey) };
  }

  async openSignature(user: AuthUser, id: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      select: { ticketId: true, signatureKey: true },
    });
    if (!visit) {
      throw new AppException('VISIT_NOT_FOUND', 'That visit no longer exists.', HttpStatus.NOT_FOUND);
    }
    await this.tickets.visibleId(user, visit.ticketId);
    if (!visit.signatureKey) {
      throw new AppException(
        'FILE_NOT_FOUND',
        'This visit has no signature on file.',
        HttpStatus.NOT_FOUND,
      );
    }
    return { signatureKey: visit.signatureKey, stream: this.storage.read(visit.signatureKey) };
  }

  async setSignature(user: AuthUser, id: string, file: UploadedFileLike | undefined) {
    const visit = await this.loadDraft(user, id);
    if (!file?.buffer?.length) {
      throw new AppException('FILE_MISSING', 'Draw a signature first.', HttpStatus.BAD_REQUEST);
    }
    if (file.size > MAX_SIGNATURE_BYTES) {
      throw new AppException(
        'FILE_TOO_LARGE',
        'Signatures can be up to 2 MB.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const type = detectFileType(file.buffer);
    if (!type || !type.mime.startsWith('image/')) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        'The signature must be an image.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const storageKey = await this.storage.save(`visits/${id}`, type.ext, file.buffer);
    const oldKey = visit.signatureKey;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.visit.update({
          where: { id },
          data: {
            signatureKey: storageKey,
            signatureRefused: false,
            refusalReason: null,
            version: { increment: 1 },
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: 'visit.signature',
            entityType: 'Visit',
            entityId: id,
            summary: `Captured the customer signature on visit ${visit.visitNumber} (${visit.ticket.number})`,
          },
          tx,
        );
      });
    } catch (error) {
      await this.storage.remove(storageKey);
      throw error;
    }
    if (oldKey && oldKey !== storageKey) await this.storage.remove(oldKey);
    return { hasSignature: true };
  }

  async refuseSignature(user: AuthUser, id: string, dto: RefuseSignatureDto) {
    const visit = await this.loadDraft(user, id);
    const oldKey = visit.signatureKey;
    await this.prisma.$transaction(async (tx) => {
      await tx.visit.update({
        where: { id },
        data: {
          signatureKey: null,
          signatureRefused: true,
          refusalReason: dto.reason,
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'visit.signature.refused',
          entityType: 'Visit',
          entityId: id,
          summary: `Customer refused to sign visit ${visit.visitNumber} (${visit.ticket.number}): ${dto.reason}`,
        },
        tx,
      );
    });
    if (oldKey) await this.storage.remove(oldKey);
    return { hasSignature: false, signatureRefused: true };
  }

  /**
   * Submitting locks the visit. Idempotent: submitting twice returns 409, so a
   * retried tap can never create a duplicate submission.
   */
  async submit(user: AuthUser, id: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      include: {
        ticket: {
          select: { id: true, number: true, title: true, engineerId: true, areaManagerId: true },
        },
        spares: { select: { itemId: true, quantity: true } },
      },
    });
    if (!visit) {
      throw new AppException('VISIT_NOT_FOUND', 'That visit no longer exists.', HttpStatus.NOT_FOUND);
    }
    await this.tickets.visibleId(user, visit.ticketId);
    this.assertCanWork(user, visit.ticket);
    const submitted = await this.prisma.$transaction(async (tx) => {
      if (visit.status === 'SUBMITTED') {
        throw new AppException(
          'VISIT_ALREADY_SUBMITTED',
          'This visit is already submitted.',
          HttpStatus.CONFLICT,
        );
      }
      if (!visit.workDone?.trim()) {
        throw new AppException(
          'VISIT_NOTES_REQUIRED',
          'Write up what was done before submitting the visit.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (!visit.signatureKey && !visit.signatureRefused) {
        throw new AppException(
          'VISIT_SIGNATURE_REQUIRED',
          'Capture the customer signature (or record a refusal) before submitting.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      // The DRAFT guard in the where clause makes the submit exactly-once: two
      // overlapping submits both pass the pre-transaction read, but only one
      // write wins; the loser gets P2025 and a clean 409 instead of duplicate
      // notifications/audit rows.
      const next = await tx.visit
        .update({
          where: { id, status: 'DRAFT' },
          data: {
            status: 'SUBMITTED',
            submittedAt: new Date(),
            submittedById: user.id,
            version: { increment: 1 },
          },
        })
        .catch((error: { code?: string }) => {
          if (error?.code === 'P2025') {
            throw new AppException(
              'VISIT_ALREADY_SUBMITTED',
              'This visit is already submitted.',
              HttpStatus.CONFLICT,
            );
          }
          throw error;
        });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'visit.submit',
          entityType: 'Visit',
          entityId: id,
          summary: `Submitted visit ${visit.visitNumber} on ticket ${visit.ticket.number}`,
        },
        tx,
      );
      return next;
    });
    // After the commit: the event feeds session 11, the bell tells the managers.
    await this.events.emitSubmitted({
      visitId: id,
      ticketId: visit.ticketId,
      submittedById: user.id,
      submittedAt: submitted.submittedAt as Date,
      spareLines: visit.spares,
    });
    await this.notifier.visitSubmitted(visit.ticket, visit.visitNumber, {
      id: user.id,
      name: user.name,
    });
    // Session 11: queue the ERP stock entry for spares used. Never throws, so
    // the submit is never blocked by write-back queueing. Demo visits never
    // write back.
    if (!submitted.isDemo) {
      await this.writebacks.onVisitSubmitted(id, user.id);
    }
    const { signatureKey, ...rest } = submitted;
    return { ...rest, hasSignature: !!signatureKey };
  }
}

function cleanFileName(name: string, ext: string): string {
  const base = name
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w\- ()]+/g, '_')
    .trim()
    .slice(0, 80);
  return `${base || 'file'}.${ext}`;
}
