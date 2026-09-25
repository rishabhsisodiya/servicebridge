import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { AuditService } from '../core/audit/audit.service';
import { validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { assertVersion, notFound, rethrowUnique } from './common';
import type { SkillDto, UpdateSkillDto } from './dto';

type Actor = { actor: AuthUser; client: ClientInfo };

const skillExists = (error: unknown) =>
  rethrowUnique(error, 'SKILL_EXISTS', 'name', 'A skill with that name already exists.');

const listSummary = (items: string[]) => items.slice().sort().join(', ') || '—';

/** Machine skills: which models need them, and which engineers have them. */
@Injectable()
export class SkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const skills = await this.prisma.skillTag.findMany({
      orderBy: { name: 'asc' },
      include: { users: { select: { user: { select: { id: true, name: true, status: true } } } } },
    });
    return skills.map(({ users, ...skill }) => ({
      ...skill,
      engineers: users.map((u) => u.user).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  /** Machine models seen on equipment, and engineers who can be tagged. */
  async options() {
    const [models, engineers] = await Promise.all([
      this.prisma.equipment.groupBy({
        by: ['itemCode', 'itemName'],
        where: { itemCode: { not: null } },
        _count: { _all: true },
        orderBy: { itemCode: 'asc' },
      }),
      this.prisma.user.findMany({
        where: { role: 'ENGINEER', status: { not: 'DEACTIVATED' } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, region: { select: { name: true } } },
      }),
    ]);
    // One row per model code; ERP data can carry more than one name for a code.
    const byCode = new Map<string, { code: string; name: string | null; machineCount: number }>();
    for (const m of models) {
      const code = m.itemCode as string;
      const row = byCode.get(code) ?? { code, name: m.itemName, machineCount: 0 };
      row.machineCount += m._count._all;
      byCode.set(code, row);
    }
    return {
      models: [...byCode.values()],
      engineers: engineers.map((e) => ({ id: e.id, name: e.name, region: e.region?.name ?? null })),
    };
  }

  private async validate(dto: SkillDto, tx: Prisma.TransactionClient) {
    const models = [...new Set(dto.equipmentModels.map((m) => m.trim()).filter(Boolean))];
    const userIds = [...new Set(dto.userIds)];
    if (models.some((m) => m.length > 140)) {
      throw validationFailed([
        { field: 'equipmentModels', message: 'Model codes are at most 140 characters.' },
      ]);
    }
    if (userIds.length) {
      const found = await tx.user.count({ where: { id: { in: userIds }, role: 'ENGINEER' } });
      if (found !== userIds.length) {
        throw validationFailed([{ field: 'userIds', message: 'Choose engineers from the list.' }]);
      }
    }
    return { models, userIds };
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
        entityType: 'skill',
        entityId: id,
        summary: `${actor.name} ${summary}`,
        changes,
        ip: client.ip,
        requestId: client.requestId,
      },
      tx,
    );
  }

  async create(dto: SkillDto, who: Actor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { models, userIds } = await this.validate(dto, tx);
        const skill = await tx.skillTag.create({
          data: {
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            equipmentModels: models,
            users: { createMany: { data: userIds.map((userId) => ({ userId })) } },
          },
        });
        await this.record(tx, who, 'skill.created', skill.id, `added skill ${skill.name}`);
        return skill;
      });
    } catch (error) {
      skillExists(error);
    }
  }

  async update(id: string, dto: UpdateSkillDto, who: Actor) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const skill = await tx.skillTag.findUnique({ where: { id }, include: { users: true } });
        if (!skill) throw notFound('SKILL_NOT_FOUND', 'skill');
        assertVersion(skill.version, dto.version, 'skill');
        const { models, userIds } = await this.validate(dto, tx);
        await tx.userSkill.deleteMany({ where: { skillTagId: id } });
        await tx.userSkill.createMany({
          data: userIds.map((userId) => ({ userId, skillTagId: id })),
        });
        const updated = await tx.skillTag.update({
          where: { id },
          data: {
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            equipmentModels: models,
            version: { increment: 1 },
          },
        });
        const before = {
          name: skill.name,
          description: skill.description,
          equipmentModels: listSummary(skill.equipmentModels),
        };
        const after = {
          name: updated.name,
          description: updated.description,
          equipmentModels: listSummary(models),
        };
        const changes: Record<string, { from: unknown; to: unknown }> = Object.fromEntries(
          (Object.keys(before) as (keyof typeof before)[])
            .filter((k) => before[k] !== after[k])
            .map((k) => [k, { from: before[k], to: after[k] }]),
        );
        const sameEngineers =
          skill.users.length === userIds.length &&
          skill.users.every((u) => userIds.includes(u.userId));
        if (!sameEngineers) changes.engineers = { from: skill.users.length, to: userIds.length };
        if (Object.keys(changes).length) {
          await this.record(
            tx,
            who,
            'skill.updated',
            id,
            `updated skill ${updated.name}: ${Object.keys(changes).join(', ')}`,
            changes,
          );
        }
        return updated;
      });
    } catch (error) {
      skillExists(error);
    }
  }

  async remove(id: string, who: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const skill = await tx.skillTag.findUnique({ where: { id } });
      if (!skill) throw notFound('SKILL_NOT_FOUND', 'skill');
      await tx.skillTag.delete({ where: { id } });
      await this.record(tx, who, 'skill.deleted', id, `deleted skill ${skill.name}`);
    });
  }
}
