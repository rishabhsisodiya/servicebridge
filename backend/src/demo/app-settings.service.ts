import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser, ClientInfo } from '../auth/auth.types';
import { AuditService } from '../core/audit/audit.service';
import { validationFailed } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';

export interface CompanySettings {
  name: string;
  timezone: string;
  currency: string;
  gstRatePercent: number;
}

export const COMPANY_KEY = 'company';
export const DEFAULT_COMPANY: CompanySettings = {
  name: 'ServiceBridge',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  gstRatePercent: 18,
};

function timezoneValid(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Company-wide settings stored in AppSetting. */
@Injectable()
export class AppSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async company(): Promise<CompanySettings> {
    const row = await this.prisma.appSetting.findUnique({ where: { key: COMPANY_KEY } });
    return { ...DEFAULT_COMPANY, ...((row?.value as Partial<CompanySettings>) ?? {}) };
  }

  async hasCompany(): Promise<boolean> {
    return !!(await this.prisma.appSetting.findUnique({ where: { key: COMPANY_KEY } }));
  }

  async setCompany(
    value: CompanySettings,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.appSetting.upsert({
      where: { key: COMPANY_KEY },
      create: { key: COMPANY_KEY, value: value as unknown as Prisma.InputJsonValue },
      update: { value: value as unknown as Prisma.InputJsonValue },
    });
  }

  async updateCompany(
    actor: AuthUser,
    input: Partial<CompanySettings>,
    client: ClientInfo,
  ): Promise<CompanySettings> {
    const current = await this.company();
    const next = { ...current, ...input, name: (input.name ?? current.name).trim() };
    const problems = [
      next.name.length < 2 && { field: 'name', message: 'Enter the company name.' },
      !timezoneValid(next.timezone) && { field: 'timezone', message: 'Choose a valid time zone.' },
      !/^[A-Z]{3}$/.test(next.currency) && {
        field: 'currency',
        message: 'Use a 3-letter currency code, e.g. INR.',
      },
      !(next.gstRatePercent >= 0 && next.gstRatePercent <= 100) && {
        field: 'gstRatePercent',
        message: 'Use a rate from 0 to 100.',
      },
    ].filter((p): p is { field: string; message: string } => !!p);
    if (problems.length) throw validationFailed(problems);

    await this.setCompany(next);
    const changed = (Object.keys(next) as (keyof CompanySettings)[]).filter(
      (k) => next[k] !== current[k],
    );
    if (changed.length) {
      await this.audit.record({
        actorId: actor.id,
        action: 'settings.company_updated',
        entityType: 'app_setting',
        entityId: COMPANY_KEY,
        summary: `${actor.name} changed company settings: ${changed.join(', ')}`,
        changes: Object.fromEntries(changed.map((k) => [k, { from: current[k], to: next[k] }])),
        ip: client.ip,
        requestId: client.requestId,
      });
    }
    return next;
  }
}
