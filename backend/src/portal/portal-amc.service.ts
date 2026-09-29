import { Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';
import type { CustomerIdentity } from './portal.guard';
import { equipmentName, portalNotFound } from './customer-visibility';

const contractNotFound = () =>
  portalNotFound('AMC_CONTRACT_NOT_FOUND', "That contract doesn't exist, or it isn't one of yours.");

/**
 * Customer view of AMC contracts. The contract value is commercial data and
 * is never selected, let alone returned.
 */
@Injectable()
export class PortalAmcService {
  constructor(private readonly prisma: PrismaService) {}

  async list(identity: CustomerIdentity) {
    const items = await this.prisma.amcContract.findMany({
      where: { customerId: identity.customerId },
      orderBy: { startsOn: 'desc' },
      select: {
        id: true,
        number: true,
        status: true,
        startsOn: true,
        endsOn: true,
        _count: { select: { equipment: true } },
      },
    });
    return {
      items: items.map((c) => ({
        id: c.id,
        number: c.number,
        status: c.status,
        startsOn: c.startsOn,
        endsOn: c.endsOn,
        equipmentCount: c._count.equipment,
      })),
    };
  }

  async detail(identity: CustomerIdentity, id: string) {
    const contract = await this.prisma.amcContract.findFirst({
      where: { id, customerId: identity.customerId },
      select: {
        id: true,
        number: true,
        status: true,
        startsOn: true,
        endsOn: true,
        equipment: {
          select: { equipment: { select: { id: true, itemName: true, serialNo: true } } },
        },
        plannedVisits: {
          orderBy: { plannedOn: 'asc' },
          select: {
            id: true,
            plannedOn: true,
            status: true,
            equipment: { select: { id: true, itemName: true, serialNo: true } },
          },
        },
      },
    });
    if (!contract) throw contractNotFound();
    return {
      id: contract.id,
      number: contract.number,
      status: contract.status,
      startsOn: contract.startsOn,
      endsOn: contract.endsOn,
      equipment: contract.equipment.map((link) => ({
        id: link.equipment.id,
        name: equipmentName(link.equipment),
      })),
      plannedVisits: contract.plannedVisits.map((visit) => ({
        id: visit.id,
        plannedOn: visit.plannedOn,
        status: visit.status,
        equipment: visit.equipment
          ? { id: visit.equipment.id, name: equipmentName(visit.equipment) }
          : null,
      })),
    };
  }
}
