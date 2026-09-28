import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../core/audit/audit.service';
import { AppException, validationFailed } from '../core/http/app.exception';
import { generateToken, hashToken } from '../core/security/tokens';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { PERMISSIONS, type Permission } from '../auth/permissions';
import { CreatePartnerKeyDto } from './dto';

export const PARTNER_READ: Permission = 'partner.read';
export const PARTNER_EDIT: Permission = 'partner.edit';

export const KEY_PREFIX = 'sbp_';
const KNOWN = new Set<string>(PERMISSIONS);

export interface PartnerKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdBy: { id: string; name: string } | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class PartnerKeyService {
  private readonly logger = new Logger(PartnerKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<PartnerKeyView[]> {
    const rows = await this.prisma.partnerApiKey.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return rows.map(toView);
  }

  /**
   * Creates a key and returns the raw value exactly once. Only the SHA-256
   * hash is stored — a database leak can't be replayed as API access.
   */
  async create(
    creator: AuthUser,
    dto: CreatePartnerKeyDto,
    client: ClientInfo,
  ): Promise<{ key: PartnerKeyView; rawKey: string }> {
    const scopes = [...new Set(dto.scopes.map((s) => s.trim()).filter(Boolean))];
    const problems = scopes
      .filter((s) => !KNOWN.has(s) || !creator.permissions.includes(s as Permission))
      .map((s) => ({
        field: 'scopes',
        message: `Unknown or unheld permission: ${s}.`,
      }));
    if (!scopes.length) problems.push({ field: 'scopes', message: 'Grant at least one permission.' });
    if (problems.length) throw validationFailed(problems);

    const rawKey = `${KEY_PREFIX}${generateToken()}`;
    const created = await this.prisma.$transaction(async (tx) => {
      const key = await tx.partnerApiKey.create({
        data: {
          name: dto.name.trim(),
          keyHash: hashToken(rawKey),
          keyPrefix: rawKey.slice(0, 12),
          scopes,
          createdById: creator.id,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      await this.audit.record(
        {
          actorId: creator.id,
          action: 'partner.key_created',
          entityType: 'PartnerApiKey',
          entityId: key.id,
          summary: `Partner API key "${key.name}" created (${key.keyPrefix}…).`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
      return key;
    });
    this.logger.log({ keyId: created.id, creatorId: creator.id }, 'Partner API key created');
    return { key: toView(created), rawKey };
  }

  async revoke(actor: AuthUser, id: string, client: ClientInfo): Promise<PartnerKeyView> {
    const existing = await this.prisma.partnerApiKey.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!existing) {
      throw new AppException('NOT_FOUND', 'That API key does not exist.', 404);
    }
    if (existing.revokedAt) return toView(existing);
    const revoked = await this.prisma.$transaction(async (tx) => {
      const key = await tx.partnerApiKey.update({
        where: { id },
        data: { revokedAt: new Date() },
        include: { createdBy: { select: { id: true, name: true } } },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'partner.key_revoked',
          entityType: 'PartnerApiKey',
          entityId: key.id,
          summary: `Partner API key "${key.name}" revoked.`,
          ip: client.ip,
          requestId: client.requestId,
        },
        tx,
      );
      return key;
    });
    this.logger.log({ keyId: id, actorId: actor.id }, 'Partner API key revoked');
    return toView(revoked);
  }
}

function toView(
  row: Prisma.PartnerApiKeyGetPayload<{ include: { createdBy: { select: { id: true; name: true } } } }>,
): PartnerKeyView {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes,
    createdBy: row.createdBy,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}
