import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { AuditService } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { assertVersion, notFound } from '../service-rules/common';
import { AmcSchedulerService } from './amc-scheduler.service';
import type {
  AddPlannedVisitDto,
  AmcContractQueryDto,
  CreateAmcContractDto,
  UpdateAmcContractDto,
} from './dto';

/**
 * AMC contracts. The equipment date bookkeeping follows the active-local-contract-wins
 * rule: equipment.amcExpiresOn is the latest endsOn of the ACTIVE contracts covering it.
 * The scheduler (amc-scheduler.service) owns all timers; this service calls into it after
 * every change that moves a date.
 */
@Injectable()
export class AmcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scheduler: AmcSchedulerService,
  ) {}

  // ─── Reading ──────────────────────────────────────────────────────────────

  async list(query: AmcContractQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const where: Prisma.AmcContractWhereInput = {};
    if (query.status) where.status = query.status as never;
    if (query.customerId) where.customerId = query.customerId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { number: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.amcContract.count({ where }),
      this.prisma.amcContract.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, name: true } },
          _count: { select: { equipment: true, plannedVisits: true } },
        },
      }),
    ]);
    return {
      data: rows.map((c) => ({
        ...c,
        equipmentCount: c._count.equipment,
        plannedVisitCount: c._count.plannedVisits,
        _count: undefined,
      })),
      page,
      pageSize,
      total,
    };
  }

  async get(id: string) {
    const contract = await this.prisma.amcContract.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, email: true, mobile: true } },
        equipment: {
          include: { equipment: { select: { id: true, itemName: true, serialNo: true, amcExpiresOn: true } } },
          orderBy: { createdAt: 'asc' },
        },
        plannedVisits: { orderBy: { plannedOn: 'asc' } },
        serviceType: { select: { id: true, name: true } },
        preferredEngineer: { select: { id: true, name: true, status: true } },
      },
    });
    if (!contract) throw notFound('AMC_CONTRACT_NOT_FOUND', 'AMC contract');
    return contract;
  }

  // ─── Writing ──────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateAmcContractDto, client: ClientInfo) {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw validationFailed([{ field: 'customerId', message: 'Choose a customer from the list.' }]);
    this.assertDates(dto.startsOn, dto.endsOn);
    const [serviceType, engineer] = await Promise.all([
      dto.serviceTypeId ? this.prisma.serviceType.findUnique({ where: { id: dto.serviceTypeId } }) : null,
      dto.preferredEngineerId ? this.prisma.user.findUnique({ where: { id: dto.preferredEngineerId } }) : null,
    ]);
    if (dto.serviceTypeId && (!serviceType || !serviceType.active))
      throw validationFailed([{ field: 'serviceTypeId', message: 'Choose an active service type.' }]);
    if (dto.preferredEngineerId && (!engineer || engineer.status !== 'ACTIVE'))
      throw validationFailed([{ field: 'preferredEngineerId', message: 'Choose an active engineer.' }]);
    const equipmentIds = dto.equipmentIds ?? [];
    await this.assertEquipmentBelongs(equipmentIds, dto.customerId);

    const number = await this.nextNumber(new Date());
    const contract = await this.prisma.$transaction(async (tx) => {
      const created = await tx.amcContract.create({
        data: {
          number,
          customerId: dto.customerId,
          startsOn: new Date(dto.startsOn),
          endsOn: new Date(dto.endsOn),
          billingUnit: dto.billingUnit ?? 'FIXED',
          value: dto.value ?? null,
          serviceTypeId: dto.serviceTypeId ?? null,
          preferredEngineerId: dto.preferredEngineerId ?? null,
          notes: dto.notes?.trim() || null,
          createdById: user.id,
          equipment:
            equipmentIds.length > 0
              ? { create: equipmentIds.map((equipmentId) => ({ equipmentId })) }
              : undefined,
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'amc.contract_created',
        entityType: 'amc_contract',
        entityId: created.id,
        summary: `${user.name} created AMC contract ${number} for ${customer.name}`,
        ip: client.ip,
        requestId: client.requestId,
      }, tx);
      return created;
    });
    return this.get(contract.id);
  }

  async update(user: AuthUser, id: string, dto: UpdateAmcContractDto, client: ClientInfo) {
    const contract = await this.get(id);
    if (contract.status === 'EXPIRED' || contract.status === 'CANCELLED') {
      throw new AppException(
        'AMC_CONTRACT_CLOSED',
        `Contract ${contract.number} is ${contract.status.toLowerCase()} and can't be edited.`,
        HttpStatus.CONFLICT,
      );
    }
    assertVersion(contract.version, dto.version, 'contract');
    const startsOn = dto.startsOn ?? contract.startsOn.toISOString().slice(0, 10);
    const endsOn = dto.endsOn ?? contract.endsOn.toISOString().slice(0, 10);
    this.assertDates(startsOn, endsOn);
    if (dto.serviceTypeId) {
      const st = await this.prisma.serviceType.findUnique({ where: { id: dto.serviceTypeId } });
      if (!st || !st.active) throw validationFailed([{ field: 'serviceTypeId', message: 'Choose an active service type.' }]);
    }
    if (dto.preferredEngineerId) {
      const eng = await this.prisma.user.findUnique({ where: { id: dto.preferredEngineerId } });
      if (!eng || eng.status !== 'ACTIVE')
        throw validationFailed([{ field: 'preferredEngineerId', message: 'Choose an active engineer.' }]);
    }
    const datesChanged = startsOn !== contract.startsOn.toISOString().slice(0, 10) || endsOn !== contract.endsOn.toISOString().slice(0, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.amcContract.update({
        where: { id },
        data: {
          startsOn: new Date(startsOn),
          endsOn: new Date(endsOn),
          billingUnit: dto.billingUnit ?? undefined,
          value: dto.value ?? undefined,
          serviceTypeId: dto.serviceTypeId === null ? null : (dto.serviceTypeId ?? undefined),
          preferredEngineerId: dto.preferredEngineerId === null ? null : (dto.preferredEngineerId ?? undefined),
          notes: dto.notes === null ? null : (dto.notes?.trim() || undefined),
          version: { increment: 1 },
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'amc.contract_updated',
        entityType: 'amc_contract',
        entityId: id,
        summary: `${user.name} updated AMC contract ${contract.number}`,
        ip: client.ip,
        requestId: client.requestId,
      }, tx);
    });
    if (datesChanged) {
      const ids = contract.equipment.map((e) => e.equipmentId);
      await this.recomputeEquipmentDates(ids);
    }
    await this.scheduler.sync(id);
    return this.get(id);
  }

  /** DRAFT → ACTIVE. Starts the PM/renewal/expiry timers and stamps equipment dates. */
  async activate(user: AuthUser, id: string, version: number, client: ClientInfo) {
    const contract = await this.get(id);
    if (contract.status !== 'DRAFT') {
      throw new AppException(
        'AMC_TRANSITION_INVALID',
        `Contract ${contract.number} is ${contract.status.toLowerCase()}; only drafts can be activated.`,
        HttpStatus.CONFLICT,
      );
    }
    assertVersion(contract.version, version, 'contract');
    await this.prisma.$transaction(async (tx) => {
      await tx.amcContract.update({
        where: { id },
        data: { status: 'ACTIVE', version: { increment: 1 } },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'amc.contract_activated',
        entityType: 'amc_contract',
        entityId: id,
        summary: `${user.name} activated AMC contract ${contract.number}`,
        ip: client.ip,
        requestId: client.requestId,
      }, tx);
    });
    await this.recomputeEquipmentDates(contract.equipment.map((e) => e.equipmentId));
    await this.scheduler.sync(id);
    return this.get(id);
  }

  /** DRAFT/ACTIVE → CANCELLED. Equipment dates fall back to any remaining active contract. */
  async cancel(user: AuthUser, id: string, version: number, client: ClientInfo) {
    const contract = await this.get(id);
    if (contract.status !== 'DRAFT' && contract.status !== 'ACTIVE') {
      throw new AppException(
        'AMC_TRANSITION_INVALID',
        `Contract ${contract.number} is ${contract.status.toLowerCase()} and can't be cancelled.`,
        HttpStatus.CONFLICT,
      );
    }
    assertVersion(contract.version, version, 'contract');
    const equipmentIds = contract.equipment.map((e) => e.equipmentId);
    await this.prisma.$transaction(async (tx) => {
      await tx.amcContract.update({
        where: { id },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'amc.contract_cancelled',
        entityType: 'amc_contract',
        entityId: id,
        summary: `${user.name} cancelled AMC contract ${contract.number}`,
        ip: client.ip,
        requestId: client.requestId,
      }, tx);
    });
    await this.scheduler.cancel(id);
    await this.recomputeEquipmentDates(equipmentIds);
    return this.get(id);
  }

  // ─── Equipment links ──────────────────────────────────────────────────────

  async addEquipment(user: AuthUser, id: string, equipmentId: string, client: ClientInfo) {
    const contract = await this.get(id);
    if (contract.status !== 'DRAFT' && contract.status !== 'ACTIVE') {
      throw new AppException(
        'AMC_CONTRACT_CLOSED',
        `Contract ${contract.number} is ${contract.status.toLowerCase()} and can't be changed.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.assertEquipmentBelongs([equipmentId], contract.customerId);
    await this.prisma.$transaction(async (tx) => {
      await tx.amcContractEquipment.upsert({
        where: { contractId_equipmentId: { contractId: id, equipmentId } },
        update: {},
        create: { contractId: id, equipmentId },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'amc.equipment_added',
        entityType: 'amc_contract',
        entityId: id,
        summary: `${user.name} added a machine to AMC contract ${contract.number}`,
        ip: client.ip,
        requestId: client.requestId,
      }, tx);
    });
    if (contract.status === 'ACTIVE') await this.recomputeEquipmentDates([equipmentId]);
    await this.scheduler.sync(id);
    return this.get(id);
  }

  async removeEquipment(user: AuthUser, id: string, equipmentId: string, client: ClientInfo) {
    const contract = await this.get(id);
    if (contract.status !== 'DRAFT' && contract.status !== 'ACTIVE') {
      throw new AppException(
        'AMC_CONTRACT_CLOSED',
        `Contract ${contract.number} is ${contract.status.toLowerCase()} and can't be changed.`,
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.amcContractEquipment.deleteMany({ where: { contractId: id, equipmentId } });
      await tx.amcPlannedVisit.deleteMany({ where: { contractId: id, equipmentId } });
      await this.audit.record({
        actorId: user.id,
        action: 'amc.equipment_removed',
        entityType: 'amc_contract',
        entityId: id,
        summary: `${user.name} removed a machine from AMC contract ${contract.number}`,
        ip: client.ip,
        requestId: client.requestId,
      }, tx);
    });
    if (contract.status === 'ACTIVE') await this.recomputeEquipmentDates([equipmentId]);
    await this.scheduler.sync(id);
    return this.get(id);
  }

  // ─── Planned visits ───────────────────────────────────────────────────────

  async addPlannedVisit(user: AuthUser, id: string, dto: AddPlannedVisitDto, client: ClientInfo) {
    const contract = await this.get(id);
    if (contract.status !== 'DRAFT' && contract.status !== 'ACTIVE') {
      throw new AppException(
        'AMC_CONTRACT_CLOSED',
        `Contract ${contract.number} is ${contract.status.toLowerCase()} and can't be changed.`,
        HttpStatus.CONFLICT,
      );
    }
    const plannedOn = new Date(dto.plannedOn);
    if (dto.equipmentId) {
      const linked = contract.equipment.some((e) => e.equipmentId === dto.equipmentId);
      if (!linked)
        throw validationFailed([{ field: 'equipmentId', message: 'That machine is not covered by this contract.' }]);
    }
    const visit = await this.prisma.$transaction(async (tx) => {
      const created = await tx.amcPlannedVisit.create({
        data: {
          contractId: id,
          equipmentId: dto.equipmentId ?? null,
          plannedOn,
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'amc.visit_planned',
        entityType: 'amc_contract',
        entityId: id,
        summary: `${user.name} planned a visit on ${dto.plannedOn} for AMC contract ${contract.number}`,
        ip: client.ip,
        requestId: client.requestId,
      }, tx);
      return created;
    });
    await this.scheduler.sync(id);
    return visit;
  }

  async removePlannedVisit(user: AuthUser, id: string, visitId: string, client: ClientInfo) {
    const contract = await this.get(id);
    const visit = contract.plannedVisits.find((v) => v.id === visitId);
    if (!visit) throw notFound('AMC_VISIT_NOT_FOUND', 'planned visit');
    if (visit.status !== 'PLANNED') {
      throw new AppException(
        'AMC_VISIT_LOCKED',
        'That visit already produced a ticket and can no longer be removed.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.amcPlannedVisit.delete({ where: { id: visitId } });
      await this.audit.record({
        actorId: user.id,
        action: 'amc.visit_removed',
        entityType: 'amc_contract',
        entityId: id,
        summary: `${user.name} removed a planned visit from AMC contract ${contract.number}`,
        ip: client.ip,
        requestId: client.requestId,
      }, tx);
    });
    await this.scheduler.sync(id);
    return { removed: true };
  }

  // ─── Equipment date bookkeeping ───────────────────────────────────────────

  /**
   * The active-local-contract-wins rule: for each machine, amcExpiresOn is the
   * latest endsOn among the ACTIVE contracts covering it. Machines with no
   * active contract keep whatever date they had (ERP sync fills it back in).
   */
  async recomputeEquipmentDates(equipmentIds: string[]): Promise<void> {
    if (equipmentIds.length === 0) return;
    for (const equipmentId of equipmentIds) {
      const latest = await this.prisma.amcContract.findFirst({
        where: { status: 'ACTIVE', equipment: { some: { equipmentId } } },
        orderBy: { endsOn: 'desc' },
        select: { endsOn: true },
      });
      if (latest) {
        await this.prisma.equipment.update({
          where: { id: equipmentId },
          data: { amcExpiresOn: latest.endsOn },
        });
      }
    }
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private assertDates(startsOn: string, endsOn: string): void {
    const problems: { field: string; message: string }[] = [];
    const start = new Date(startsOn);
    const end = new Date(endsOn);
    if (Number.isNaN(start.getTime())) problems.push({ field: 'startsOn', message: 'Enter a valid start date.' });
    if (Number.isNaN(end.getTime())) problems.push({ field: 'endsOn', message: 'Enter a valid end date.' });
    if (problems.length === 0 && end < start)
      problems.push({ field: 'endsOn', message: 'The end date must be on or after the start date.' });
    if (problems.length) throw validationFailed(problems);
  }

  private async assertEquipmentBelongs(equipmentIds: string[], customerId: string): Promise<void> {
    if (equipmentIds.length === 0) return;
    const rows = await this.prisma.equipment.findMany({
      where: { id: { in: equipmentIds } },
      select: { id: true, customerId: true },
    });
    const missing = equipmentIds.filter((id) => !rows.some((r) => r.id === id));
    const wrongCustomer = rows.filter((r) => r.customerId !== customerId);
    const problems: { field: string; message: string }[] = [];
    if (missing.length)
      problems.push({ field: 'equipmentIds', message: 'Some machines no longer exist. Refresh and try again.' });
    if (wrongCustomer.length)
      problems.push({ field: 'equipmentIds', message: "Some machines don't belong to this customer." });
    if (problems.length) throw validationFailed(problems);
  }

  /** Yearly sequence: AMC-26-000123. One counter row per year keeps it gap-tolerant. */
  private async nextNumber(now: Date): Promise<string> {
    const year = now.getFullYear();
    const two = String(year).slice(-2);
    const counter = await this.prisma.amcContractCounter.upsert({
      where: { year },
      update: { lastNumber: { increment: 1 } },
      create: { year, lastNumber: 1 },
    });
    return `AMC-${two}-${String(counter.lastNumber).padStart(6, '0')}`;
  }
}
