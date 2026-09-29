import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../core/http/app.exception';
import type { PrismaService } from '../core/prisma/prisma.service';
import type { StorageService } from '../core/storage/storage.service';
import { TicketAttachmentsService, type UploadedFileLike } from './ticket-attachments.service';
import type { TicketsService } from './tickets.service';

const readOnly = {
  id: 'u1',
  permissions: ['tickets.read'],
  ticketScope: 'ALL',
  regionId: null,
} as unknown as AuthUser;

const engineer = {
  id: 'u2',
  permissions: ['tickets.work'],
  ticketScope: 'ALL',
  regionId: null,
} as unknown as AuthUser;

const desk = {
  id: 'u3',
  permissions: ['tickets.create'],
  ticketScope: 'ALL',
  regionId: null,
} as unknown as AuthUser;

/** A minimal PDF (magic bytes + padding past the 12-byte signature check). */
const pdfFile = (name = 'report.pdf'): UploadedFileLike => ({
  originalname: name,
  size: 64,
  buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(56)]),
});

function build() {
  const attachment = {
    id: 'a1',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 64,
    createdAt: new Date(),
  };
  const tx = {
    ticketAttachment: { create: jest.fn().mockResolvedValue(attachment) },
    ticketEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ticket: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ stage: 'NEW', _count: { attachments: 0 } }),
    },
    $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
  };
  const storage = {
    save: jest.fn().mockResolvedValue('tickets/t1/key'),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const tickets = { visibleId: jest.fn().mockResolvedValue('t1') };
  const service = new TicketAttachmentsService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    tickets as unknown as TicketsService,
  );
  return { service, prisma, storage, tickets, tx };
}

async function catchError(promise: Promise<unknown>): Promise<AppException> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    return error as AppException;
  }
  throw new Error('Expected the promise to reject, but it resolved.');
}

describe('TicketAttachmentsService.upload (SB-M2)', () => {
  it('rejects a read-only user before touching storage or the DB', async () => {
    const { service, storage, prisma } = build();

    const error = await catchError(service.upload(readOnly, 't1', pdfFile()));
    expect(error.code).toBe('FORBIDDEN');
    expect(error.getStatus()).toBe(403);

    expect(storage.save).not.toHaveBeenCalled();
    expect(prisma.ticket.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('lets a user with tickets.work upload', async () => {
    const { service, storage } = build();
    const result = await service.upload(engineer, 't1', pdfFile());
    expect(result).toMatchObject({ fileName: 'report.pdf', mimeType: 'application/pdf' });
    expect(storage.save).toHaveBeenCalled();
  });

  it('lets a user with tickets.create upload (desk logging evidence)', async () => {
    const { service } = build();
    await expect(service.upload(desk, 't1', pdfFile())).resolves.toMatchObject({
      id: 'a1',
    });
  });

  it('still rejects a non-file upload for permitted users', async () => {
    const { service } = build();
    const error = await catchError(service.upload(engineer, 't1', undefined));
    expect(error.code).toBe('FILE_MISSING');
  });
});
