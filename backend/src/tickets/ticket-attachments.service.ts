import { HttpStatus, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { detectFileType, StorageService } from '../core/storage/storage.service';
import { TicketsService } from './tickets.service';
import { FINAL_STAGES } from './workflow';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_TICKET = 20;

/** What the upload interceptor hands over (multer, memory storage). */
export interface UploadedFileLike {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/** Keeps the name readable but safe to show and to put in a header. */
function cleanFileName(name: string, ext: string): string {
  const base = name
    .replace(/\.[^.]*$/, '')
    .replace(/[^\w\- ()]+/g, '_')
    .trim()
    .slice(0, 80);
  return `${base || 'file'}.${ext}`;
}

@Injectable()
export class TicketAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tickets: TicketsService,
  ) {}

  async upload(user: AuthUser, idOrNumber: string, file: UploadedFileLike | undefined) {
    // SB-M2: attaching a file is a write. Read-only users may see the ticket
    // but may not add files to it.
    if (!can(user, 'tickets.work') && !can(user, 'tickets.edit') && !can(user, 'tickets.create')) {
      throw new AppException(
        'FORBIDDEN',
        "You don't have permission to add files to tickets.",
        HttpStatus.FORBIDDEN,
      );
    }
    if (!file?.buffer?.length) {
      throw new AppException('FILE_MISSING', 'Choose a file to upload.', HttpStatus.BAD_REQUEST);
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new AppException(
        'FILE_TOO_LARGE',
        'Files can be up to 10 MB.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    const type = detectFileType(file.buffer);
    if (!type) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        'Upload a photo (JPEG, PNG or WebP) or a PDF.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    const ticketId = await this.tickets.visibleId(user, idOrNumber);
    const ticket = await this.prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { stage: true, _count: { select: { attachments: true } } },
    });
    if (FINAL_STAGES.includes(ticket.stage)) {
      throw new AppException(
        'TICKET_FINISHED',
        'Files can’t be added to a closed or cancelled ticket.',
        HttpStatus.CONFLICT,
      );
    }
    if (ticket._count.attachments >= MAX_FILES_PER_TICKET) {
      throw new AppException(
        'TOO_MANY_FILES',
        `A ticket can have up to ${MAX_FILES_PER_TICKET} files.`,
        HttpStatus.CONFLICT,
      );
    }

    const storageKey = await this.storage.save(`tickets/${ticketId}`, type.ext, file.buffer);
    const fileName = cleanFileName(file.originalname, type.ext);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const attachment = await tx.ticketAttachment.create({
          data: {
            ticketId,
            fileName,
            mimeType: type.mime,
            sizeBytes: file.size,
            storageKey,
            uploadedById: user.id,
          },
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
        });
        await tx.ticketEvent.create({
          data: {
            ticketId,
            type: 'ATTACHMENT',
            actorId: user.id,
            data: { attachmentId: attachment.id, fileName },
          },
        });
        return attachment;
      });
    } catch (error) {
      await this.storage.remove(storageKey);
      throw error;
    }
  }

  async open(user: AuthUser, idOrNumber: string, attachmentId: string) {
    const ticketId = await this.tickets.visibleId(user, idOrNumber);
    const attachment = await this.prisma.ticketAttachment.findFirst({
      where: { id: attachmentId, ticketId },
    });
    if (!attachment) {
      throw new AppException('FILE_NOT_FOUND', 'That file no longer exists.', HttpStatus.NOT_FOUND);
    }
    return { attachment, stream: this.storage.read(attachment.storageKey) };
  }

  async remove(user: AuthUser, idOrNumber: string, attachmentId: string) {
    const ticketId = await this.tickets.visibleId(user, idOrNumber);
    const attachment = await this.prisma.ticketAttachment.findFirst({
      where: { id: attachmentId, ticketId },
      include: { ticket: { select: { stage: true } } },
    });
    if (!attachment) {
      throw new AppException('FILE_NOT_FOUND', 'That file no longer exists.', HttpStatus.NOT_FOUND);
    }
    if (attachment.uploadedById !== user.id && !can(user, 'tickets.assign')) {
      throw new AppException(
        'FORBIDDEN',
        'Only the person who added a file, or a manager, can remove it.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (FINAL_STAGES.includes(attachment.ticket.stage)) {
      throw new AppException(
        'TICKET_FINISHED',
        'Files on a closed ticket are kept as a record.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction([
      this.prisma.ticketAttachment.delete({ where: { id: attachment.id } }),
      this.prisma.ticketEvent.create({
        data: {
          ticketId,
          type: 'NOTE',
          actorId: user.id,
          note: `Removed file ${attachment.fileName}`,
        },
      }),
    ]);
    await this.storage.remove(attachment.storageKey);
  }
}
