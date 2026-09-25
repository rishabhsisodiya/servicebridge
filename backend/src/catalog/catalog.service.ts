import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { coverageOf, type CoverageFilter, coverageWhere } from './coverage';

export interface PageQuery {
  page: number;
  pageSize: number;
}

const page = (q: PageQuery) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
const meta = (q: PageQuery, total: number) => ({ page: q.page, pageSize: q.pageSize, total });
const contains = (value: string) => ({ contains: value.trim(), mode: 'insensitive' as const });

/** Read-only views of master data (ERP-synced or demo). */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async customers(
    q: PageQuery & { search?: string; territory?: string; includeInactive?: boolean },
  ) {
    const where: Prisma.CustomerWhereInput = {
      ...(q.includeInactive ? {} : { active: true }),
      ...(q.territory ? { territory: q.territory } : {}),
      ...(q.search
        ? {
            OR: [
              { name: contains(q.search) },
              { taxId: contains(q.search) },
              { mobile: contains(q.search) },
              { email: contains(q.search) },
              { erpName: contains(q.search) },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        ...page(q),
        include: {
          _count: {
            select: { sites: { where: { active: true } }, equipment: { where: { active: true } } },
          },
          contacts: {
            where: { active: true },
            orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
            take: 1,
          },
        },
      }),
    ]);
    const territories = await this.prisma.customer.findMany({
      where: { active: true, territory: { not: null } },
      distinct: ['territory'],
      select: { territory: true },
      orderBy: { territory: 'asc' },
    });
    return {
      data: rows.map((c) => ({
        id: c.id,
        name: c.name,
        source: c.source,
        erpName: c.erpName,
        customerGroup: c.customerGroup,
        territory: c.territory,
        taxId: c.taxId,
        mobile: c.mobile,
        email: c.email,
        active: c.active,
        siteCount: c._count.sites,
        machineCount: c._count.equipment,
        primaryContact: c.contacts[0]
          ? { name: c.contacts[0].fullName, mobile: c.contacts[0].mobile }
          : null,
      })),
      meta: meta(q, total),
      territories: territories.map((t) => t.territory!).filter(Boolean),
    };
  }

  async customer(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        sites: { orderBy: [{ active: 'desc' }, { title: 'asc' }] },
        contacts: { orderBy: [{ active: 'desc' }, { isPrimary: 'desc' }, { fullName: 'asc' }] },
        equipment: { orderBy: [{ active: 'desc' }, { serialNo: 'asc' }] },
      },
    });
    if (!customer)
      throw new AppException(
        'CUSTOMER_NOT_FOUND',
        'That customer no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    return {
      ...customer,
      equipment: customer.equipment.map((machine) => ({ ...machine, ...coverageOf(machine) })),
    };
  }

  async equipment(
    q: PageQuery & {
      search?: string;
      coverage?: CoverageFilter;
      customerId?: string;
      includeInactive?: boolean;
    },
  ) {
    const where: Prisma.EquipmentWhereInput = {
      AND: [
        q.includeInactive ? {} : { active: true },
        q.customerId ? { customerId: q.customerId } : {},
        q.coverage ? coverageWhere(q.coverage) : {},
        q.search
          ? {
              OR: [
                { serialNo: contains(q.search) },
                { itemName: contains(q.search) },
                { itemCode: contains(q.search) },
                { customer: { name: contains(q.search) } },
              ],
            }
          : {},
      ],
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.equipment.count({ where }),
      this.prisma.equipment.findMany({
        where,
        orderBy: [{ serialNo: 'asc' }],
        ...page(q),
        include: { customer: { select: { id: true, name: true, territory: true } } },
      }),
    ]);
    return {
      data: rows.map((m) => ({
        id: m.id,
        serialNo: m.serialNo,
        itemCode: m.itemCode,
        itemName: m.itemName,
        source: m.source,
        active: m.active,
        customer: m.customer,
        customerErpName: m.customerErpName,
        warrantyExpiresOn: m.warrantyExpiresOn,
        amcExpiresOn: m.amcExpiresOn,
        ...coverageOf(m),
      })),
      meta: meta(q, total),
    };
  }

  async machine(id: string) {
    const machine = await this.prisma.equipment.findUnique({
      where: { id },
      include: { customer: { include: { sites: { where: { active: true } } } } },
    });
    if (!machine)
      throw new AppException(
        'MACHINE_NOT_FOUND',
        'That machine no longer exists.',
        HttpStatus.NOT_FOUND,
      );
    return { ...machine, ...coverageOf(machine) };
  }

  /** Items with stock per warehouse and their prices. */
  async items(q: PageQuery & { search?: string; group?: string; inStockOnly?: boolean }) {
    const where: Prisma.ItemWhereInput = {
      active: true,
      ...(q.group ? { itemGroup: q.group } : {}),
      ...(q.search ? { OR: [{ itemCode: contains(q.search) }, { name: contains(q.search) }] } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.item.count({ where }),
      this.prisma.item.findMany({ where, orderBy: { itemCode: 'asc' }, ...page(q) }),
    ]);
    const codes = items.map((item) => item.itemCode);
    const [stock, prices, groups] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where: { itemCode: { in: codes } },
        orderBy: { warehouse: 'asc' },
      }),
      this.prisma.itemPrice.findMany({
        where: { itemCode: { in: codes }, active: true, selling: true },
        orderBy: { priceList: 'asc' },
      }),
      this.prisma.item.findMany({
        where: { active: true, itemGroup: { not: null } },
        distinct: ['itemGroup'],
        select: { itemGroup: true },
        orderBy: { itemGroup: 'asc' },
      }),
    ]);
    const priceLists = [...new Set(prices.map((p) => p.priceList))];
    return {
      data: items.map((item) => {
        const itemStock = stock.filter((s) => s.itemCode === item.itemCode);
        return {
          id: item.id,
          itemCode: item.itemCode,
          name: item.name,
          itemGroup: item.itemGroup,
          uom: item.uom,
          source: item.source,
          stock: itemStock.map((s) => ({
            warehouse: s.warehouse,
            actualQty: Number(s.actualQty),
            projectedQty: Number(s.projectedQty),
          })),
          totalQty: itemStock.reduce((sum, s) => sum + Number(s.actualQty), 0),
          prices: prices
            .filter((p) => p.itemCode === item.itemCode)
            .map((p) => ({ priceList: p.priceList, rate: Number(p.rate), currency: p.currency })),
        };
      }),
      meta: meta(q, total),
      groups: groups.map((g) => g.itemGroup!).filter(Boolean),
      priceLists,
    };
  }
}
