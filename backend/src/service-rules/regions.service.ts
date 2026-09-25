import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { AuditService, diffFields } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { assertVersion, notFound, rethrowUnique } from './common';
import type { RegionDto, UpdateRegionDto } from './dto';
import { matchPincode, normalisePrefixes } from './region-match';

type Actor = { actor: AuthUser; client: ClientInfo };

/** Roles that can receive a region's new tickets. */
const MANAGER_ROLES = ['AREA_MANAGER', 'SERVICE_MANAGER', 'ADMIN'] as const;

const regionExists = (error: unknown) =>
  rethrowUnique(error, 'REGION_EXISTS', 'name', 'A region with that name already exists.');

/** Service regions, their area manager, and the pincode prefixes that route sites to them. */
@Injectable()
export class RegionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Short list for forms and filters (any signed-in user). */
  options() {
    return this.prisma.region.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  /** Every region with its rules, plus how many customer sites each one catches. */
  async list() {
    const [regions, pincodes] = await Promise.all([
      this.prisma.region.findMany({
        orderBy: { name: 'asc' },
        include: {
          areaManager: { select: { id: true, name: true } },
          rules: { select: { pincodePrefix: true }, orderBy: { pincodePrefix: 'asc' } },
          _count: { select: { users: true } },
        },
      }),
      this.prisma.site.groupBy({
        by: ['pincode'],
        where: { active: true, pincode: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const rules = regions.flatMap((r) =>
      r.rules.map((rule) => ({ pincodePrefix: rule.pincodePrefix, target: r.id })),
    );
    const siteCounts = new Map<string, number>();
    let unmatchedSites = 0;
    for (const group of pincodes) {
      const match = matchPincode(group.pincode ?? '', rules);
      if (match)
        siteCounts.set(match.target, (siteCounts.get(match.target) ?? 0) + group._count._all);
      else unmatchedSites += group._count._all;
    }
    return {
      data: regions.map((r) => ({
        id: r.id,
        name: r.name,
        isDemo: r.isDemo,
        version: r.version,
        areaManager: r.areaManager,
        pincodePrefixes: r.rules.map((rule) => rule.pincodePrefix),
        userCount: r._count.users,
        siteCount: siteCounts.get(r.id) ?? 0,
      })),
      unmatchedSites,
    };
  }

  /** People who can be a region's area manager. */
  managers() {
    return this.prisma.user.findMany({
      where: { role: { in: [...MANAGER_ROLES] }, status: { not: 'DEACTIVATED' } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true },
    });
  }

  async resolve(pincode: string) {
    const rules = await this.prisma.regionRule.findMany({
      select: {
        pincodePrefix: true,
        region: {
          select: { id: true, name: true, areaManager: { select: { id: true, name: true } } },
        },
      },
    });
    const match = matchPincode(
      pincode,
      rules.map((r) => ({ pincodePrefix: r.pincodePrefix, target: r.region })),
    );
    return { pincode, matchedPrefix: match?.pincodePrefix ?? null, region: match?.target ?? null };
  }

  /** The region (and its area manager) a site with this pincode is routed to. */
  async forPincode(pincode: string | null | undefined, db: Prisma.TransactionClient = this.prisma) {
    if (!pincode) return null;
    const rules = await db.regionRule.findMany({
      select: {
        pincodePrefix: true,
        region: { select: { id: true, name: true, areaManagerId: true } },
      },
    });
    return (
      matchPincode(
        pincode,
        rules.map((r) => ({ pincodePrefix: r.pincodePrefix, target: r.region })),
      )?.target ?? null
    );
  }

  private async validate(dto: RegionDto, regionId: string | null, tx: Prisma.TransactionClient) {
    const { prefixes, invalid } = normalisePrefixes(dto.pincodePrefixes ?? []);
    const problems: { field: string; message: string }[] = [];
    if (invalid.length) {
      problems.push({
        field: 'pincodePrefixes',
        message: `Not a pincode prefix (1–6 digits): ${invalid.slice(0, 5).join(', ')}`,
      });
    }
    if (dto.areaManagerId) {
      const manager = await tx.user.findUnique({ where: { id: dto.areaManagerId } });
      if (
        !manager ||
        manager.status === 'DEACTIVATED' ||
        !(MANAGER_ROLES as readonly string[]).includes(manager.role)
      ) {
        problems.push({ field: 'areaManagerId', message: 'Choose a manager from the list.' });
      }
    }
    if (prefixes.length) {
      const taken = await tx.regionRule.findMany({
        where: {
          pincodePrefix: { in: prefixes },
          ...(regionId ? { regionId: { not: regionId } } : {}),
        },
        select: { pincodePrefix: true, region: { select: { name: true } } },
      });
      if (taken.length) {
        problems.push({
          field: 'pincodePrefixes',
          message: `Already in another region: ${taken
            .slice(0, 5)
            .map((t) => `${t.pincodePrefix} (${t.region.name})`)
            .join(', ')}`,
        });
      }
    }
    if (problems.length) throw validationFailed(problems);
    return prefixes;
  }

  private record(
    tx: Prisma.TransactionClient,
    { actor, client }: Actor,
    action: string,
    id: string,
    summary: string,
    changes?: Record<string, { from: unknown; to: unknown }>,
  ) {
    return this.audit.record(
      {
        actorId: actor.id,
        action,
        entityType: 'region',
        entityId: id,
        summary: `${actor.name} ${summary}`,
        changes,
        ip: client.ip,
        requestId: client.requestId,
      },
      tx,
    );
  }

  async create(dto: RegionDto, who: Actor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const prefixes = await this.validate(dto, null, tx);
        const region = await tx.region.create({
          data: {
            name: dto.name.trim(),
            areaManagerId: dto.areaManagerId ?? null,
            rules: { createMany: { data: prefixes.map((pincodePrefix) => ({ pincodePrefix })) } },
          },
          select: { id: true, name: true },
        });
        await this.record(tx, who, 'region.created', region.id, `added region ${region.name}`);
        return region;
      });
    } catch (error) {
      regionExists(error);
    }
  }

  async update(id: string, dto: UpdateRegionDto, who: Actor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const region = await tx.region.findUnique({ where: { id }, include: { rules: true } });
        if (!region) throw notFound('REGION_NOT_FOUND', 'region');
        assertVersion(region.version, dto.version, 'region');
        const prefixes = await this.validate(dto, id, tx);
        const before = region.rules
          .map((r) => r.pincodePrefix)
          .sort()
          .join(', ');
        await tx.regionRule.deleteMany({ where: { regionId: id } });
        await tx.regionRule.createMany({
          data: prefixes.map((pincodePrefix) => ({ regionId: id, pincodePrefix })),
        });
        const data = { name: dto.name.trim(), areaManagerId: dto.areaManagerId ?? null };
        const changes = {
          ...diffFields({ name: region.name, areaManagerId: region.areaManagerId }, data),
          ...(before !== prefixes.join(', ')
            ? { pincodePrefixes: { from: before, to: prefixes.join(', ') } }
            : {}),
        };
        const updated = await tx.region.update({
          where: { id },
          data: { ...data, version: { increment: 1 } },
          select: { id: true, name: true },
        });
        if (Object.keys(changes).length) {
          await this.record(
            tx,
            who,
            'region.updated',
            id,
            `updated region ${updated.name}: ${Object.keys(changes).join(', ')}`,
            changes,
          );
        }
        return updated;
      });
    } catch (error) {
      regionExists(error);
    }
  }

  async remove(id: string, who: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const region = await tx.region.findUnique({
        where: { id },
        include: { _count: { select: { users: true } } },
      });
      if (!region) throw notFound('REGION_NOT_FOUND', 'region');
      if (region._count.users) {
        throw new AppException(
          'REGION_IN_USE',
          `${region._count.users} ${region._count.users === 1 ? 'person is' : 'people are'} in this region. Move them to another region first.`,
          HttpStatus.CONFLICT,
        );
      }
      await tx.region.delete({ where: { id } });
      await this.record(tx, who, 'region.deleted', id, `deleted region ${region.name}`);
    });
  }
}
