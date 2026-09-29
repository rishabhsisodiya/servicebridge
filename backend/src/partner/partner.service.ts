import { HttpStatus, Injectable } from '@nestjs/common';
import { TicketChannel, type TicketPriority } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { TicketsService } from '../tickets/tickets.service';
import type { CreateTicketDto } from '../tickets/dto';
import type { PartnerIdentity } from './partner.guard';
import { PartnerCreateTicketDto } from './dto';

/** Fields a partner may see for their own tickets. No commercial data. */
export interface PartnerTicketView {
  number: string;
  title: string;
  stage: string;
  priority: TicketPriority;
  engineer: string | null;
  createdAt: Date;
  respondedAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  slaDueAt: Date | null;
  externalRef: string | null;
}

@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Logs a ticket on behalf of a partner. Idempotent on (key, externalRef):
   * a repeat POST returns the existing ticket with `duplicate: true`.
   */
  async createTicket(
    partner: PartnerIdentity,
    dto: PartnerCreateTicketDto,
    client: ClientInfo,
  ): Promise<{ id: string; number: string; duplicate: boolean }> {
    const externalRef = dto.externalRef.trim();
    const existing = await this.prisma.ticket.findFirst({
      where: { partnerKeyId: partner.keyId, externalRef },
      select: { id: true, number: true },
    });
    if (existing) return { ...existing, duplicate: true };

    const customer = await this.resolveCustomer(dto);
    const equipment = await this.resolveEquipment(dto, customer.id);
    const serviceType = await this.resolveServiceType(dto);

    const contactLine =
      dto.contactName || dto.contactMobile
        ? `Contact: ${[dto.contactName, dto.contactMobile].filter(Boolean).join(' ')}`
        : null;
    const description = [contactLine, dto.description?.trim() || null]
      .filter(Boolean)
      .join('\n\n');

    const createDto: CreateTicketDto = {
      customerId: customer.id,
      equipmentId: equipment?.id,
      serviceTypeId: serviceType.id,
      priority: dto.priority,
      channel: TicketChannel.PARTNER,
      title: dto.title.trim(),
      description: description || undefined,
      acknowledgeDuplicates: dto.acknowledgeDuplicates,
    };

    // Partner tickets belong to ServiceBridge itself, not a person — the same
    // seam AMC automation tickets use (createdById: null).
    const actor = {
      id: `partner:${partner.keyId}`,
      email: '',
      name: `Partner API (${partner.name})`,
      roleId: '',
      isAdmin: false,
      ticketScope: 'ALL',
      regionId: null,
      permissions: [],
      sessionId: '',
      stepUpAt: null,
    } as unknown as AuthUser;

    let created: { id: string; number: string };
    try {
      // partnerKeyId/externalRef are stamped AT INSERT (via opts) so the
      // @@unique([partnerKeyId, externalRef]) constraint actually guards the
      // create — a follow-up update could never violate it and left the
      // loser's ticket an orphan with NULL fields on P2002.
      created = await this.tickets.create(actor, createDto, {
        createdById: null,
        partnerKeyId: partner.keyId,
        externalRef,
      });
    } catch (error) {
      // A concurrent repeat POST slipped past the pre-check; the unique
      // constraint on (partnerKeyId, externalRef) makes the second one safe.
      if (isUniqueViolation(error)) {
        const winner = await this.prisma.ticket.findFirst({
          where: { partnerKeyId: partner.keyId, externalRef },
          select: { id: true, number: true },
        });
        if (winner) return { ...winner, duplicate: true };
      }
      throw error;
    }

    await this.audit.record({
      actorId: null,
      action: 'partner.ticket_created',
      entityType: 'Ticket',
      entityId: created.id,
      summary: `Ticket ${created.number} logged via partner API key "${partner.name}".`,
      partnerKeyId: partner.keyId,
      ip: client.ip,
      requestId: client.requestId,
    });

    return { ...created, duplicate: false };
  }

  /** A partner sees status for their own tickets only. */
  async ticketStatus(partner: PartnerIdentity, number: string): Promise<PartnerTicketView> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { number, partnerKeyId: partner.keyId },
      include: { engineer: { select: { name: true } } },
    });
    if (!ticket) {
      // Same 404 whether the number is wrong or belongs to someone else.
      throw new AppException('NOT_FOUND', 'No ticket found with that number.', HttpStatus.NOT_FOUND);
    }
    return {
      number: ticket.number,
      title: ticket.title,
      stage: ticket.stage,
      priority: ticket.priority,
      engineer: ticket.engineer?.name ?? null,
      createdAt: ticket.createdAt,
      respondedAt: ticket.respondedAt,
      resolvedAt: ticket.resolvedAt,
      closedAt: ticket.closedAt,
      slaDueAt: ticket.slaDueAt,
      externalRef: ticket.externalRef,
    };
  }

  private async resolveCustomer(dto: PartnerCreateTicketDto) {
    if (dto.customerId) {
      const byId = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
      if (!byId || !byId.active)
        throw validationFailed([{ field: 'customerId', message: 'Unknown customer.' }]);
      return byId;
    }
    const name = dto.customerErpName?.trim();
    if (!name) {
      throw validationFailed([
        { field: 'customerErpName', message: 'Give customerId or customerErpName.' },
      ]);
    }
    const byErpName = await this.prisma.customer.findFirst({
      where: { erpName: name, active: true },
    });
    const customer =
      byErpName ??
      (await this.prisma.customer.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, active: true },
      }));
    if (!customer) {
      throw validationFailed([
        { field: 'customerErpName', message: `No customer matches "${name}".` },
      ]);
    }
    return customer;
  }

  private async resolveEquipment(dto: PartnerCreateTicketDto, customerId: string) {
    if (dto.equipmentId || dto.equipmentSerial) {
      const equipment = dto.equipmentId
        ? await this.prisma.equipment.findUnique({ where: { id: dto.equipmentId } })
        : await this.prisma.equipment.findFirst({
            where: { serialNo: dto.equipmentSerial!.trim(), active: true },
          });
      if (!equipment) {
        throw validationFailed([
          {
            field: dto.equipmentId ? 'equipmentId' : 'equipmentSerial',
            message: 'Unknown machine.',
          },
        ]);
      }
      if (equipment.customerId && equipment.customerId !== customerId) {
        throw validationFailed([
          { field: 'equipmentSerial', message: "That machine belongs to a different customer." },
        ]);
      }
      return equipment;
    }
    return null;
  }

  private async resolveServiceType(dto: PartnerCreateTicketDto) {
    if (dto.serviceTypeId) {
      const byId = await this.prisma.serviceType.findUnique({ where: { id: dto.serviceTypeId } });
      if (!byId || !byId.active)
        throw validationFailed([{ field: 'serviceTypeId', message: 'Unknown service type.' }]);
      return byId;
    }
    const name = dto.serviceTypeName?.trim();
    if (!name) {
      throw validationFailed([
        { field: 'serviceTypeName', message: 'Give serviceTypeId or serviceTypeName.' },
      ]);
    }
    const serviceType = await this.prisma.serviceType.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, active: true },
    });
    if (!serviceType) {
      throw validationFailed([
        { field: 'serviceTypeName', message: `No service type matches "${name}".` },
      ]);
    }
    return serviceType;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === 'P2002'
  );
}
