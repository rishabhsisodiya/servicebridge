import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../core/audit/audit.service';
import { AppException } from '../core/http/app.exception';
import { PrismaService } from '../core/prisma/prisma.service';
import { hashPassword } from '../core/security/password';
import { AppSettingsService } from './app-settings.service';
import {
  buildDemoData,
  DEMO_COMPANY,
  DEMO_REGIONS,
  DEMO_SKILLS,
  DEMO_USERS,
  DEMO_WAREHOUSES,
  demoEmail,
  demoPincodeRules,
} from './demo-data';

export const CLEAR_CONFIRMATION = 'DELETE DEMO DATA';

export interface DemoActor {
  id: string | null;
  name: string;
}

export interface DemoCounts {
  users: number;
  regions: number;
  customers: number;
  sites: number;
  contacts: number;
  machines: number;
  items: number;
  prices: number;
  warehouses: number;
  stockLevels: number;
}

const DEMO = { source: 'DEMO' as const };
const WORDS = [
  'granite',
  'basalt',
  'quartz',
  'gravel',
  'mantle',
  'toggle',
  'rotor',
  'screen',
  'hopper',
  'feeder',
];

/** Readable, policy-compliant shared password for demo logins. */
export function demoPassword(): string {
  const word = () => WORDS[randomInt(WORDS.length)];
  return `${word()}-${word()}-${randomInt(1000, 9999)}`;
}

/**
 * Loads and clears the fictional demo company. Demo rows are marked
 * (source = DEMO, isDemo = true), so clearing never touches ERP-synced data
 * or real users.
 */
@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
    private readonly audit: AuditService,
  ) {}

  async counts(): Promise<DemoCounts> {
    const [
      users,
      regions,
      customers,
      sites,
      contacts,
      machines,
      items,
      prices,
      warehouses,
      stockLevels,
    ] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { isDemo: true } }),
      this.prisma.region.count({ where: { isDemo: true } }),
      this.prisma.customer.count({ where: DEMO }),
      this.prisma.site.count({ where: DEMO }),
      this.prisma.customerContact.count({ where: DEMO }),
      this.prisma.equipment.count({ where: DEMO }),
      this.prisma.item.count({ where: DEMO }),
      this.prisma.itemPrice.count({ where: DEMO }),
      this.prisma.warehouse.count({ where: DEMO }),
      this.prisma.stockLevel.count({ where: DEMO }),
    ]);
    return {
      users,
      regions,
      customers,
      sites,
      contacts,
      machines,
      items,
      prices,
      warehouses,
      stockLevels,
    };
  }

  async status() {
    const counts = await this.counts();
    return { active: Object.values(counts).some((n) => n > 0), counts };
  }

  private async deleteDemo(tx: Prisma.TransactionClient): Promise<void> {
    await tx.stockLevel.deleteMany({ where: DEMO });
    await tx.itemPrice.deleteMany({ where: DEMO });
    await tx.item.deleteMany({ where: DEMO });
    await tx.warehouse.deleteMany({ where: DEMO });
    await tx.equipment.deleteMany({ where: DEMO });
    await tx.site.deleteMany({ where: DEMO });
    await tx.customerContact.deleteMany({ where: DEMO });
    await tx.customer.deleteMany({ where: DEMO });
    // Sessions and links cascade; audit entries keep their text with actor unset.
    await tx.skillTag.deleteMany({ where: { isDemo: true } });
    await tx.regionRule.deleteMany({ where: { isDemo: true } });
    await tx.user.deleteMany({ where: { isDemo: true } });
    await tx.region.deleteMany({ where: { isDemo: true } });
  }

  private assertNotDemoActor = async (actor: DemoActor) => {
    if (!actor.id) return;
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { isDemo: true },
    });
    if (user?.isDemo) {
      throw new AppException(
        'DEMO_ACTOR',
        'You are signed in as a demo user, who would be removed too. Sign in as a real administrator to do this.',
        HttpStatus.CONFLICT,
      );
    }
  };

  /** Area managers, pincode routing and machine skills for the demo regions and engineers. */
  private async seedServiceRules(
    tx: Prisma.TransactionClient,
    regionIds: Map<string, string>,
  ): Promise<void> {
    const users = await tx.user.findMany({
      where: { email: { in: DEMO_USERS.map((u) => demoEmail(u.name)) }, isDemo: true },
      select: { id: true, email: true },
    });
    const userId = new Map(users.map((u) => [u.email, u.id]));
    for (const u of DEMO_USERS.filter((u) => u.role === 'AREA_MANAGER' && u.region)) {
      const id = userId.get(demoEmail(u.name));
      const regionId = regionIds.get(u.region as string);
      // Never replace a manager an admin chose for a region they created.
      if (id && regionId) {
        await tx.region.updateMany({
          where: { id: regionId, areaManagerId: null },
          data: { areaManagerId: id },
        });
      }
    }
    await tx.regionRule.createMany({
      data: demoPincodeRules()
        .filter((r) => regionIds.has(r.region))
        .map((r) => ({
          pincodePrefix: r.pincodePrefix,
          regionId: regionIds.get(r.region) as string,
          isDemo: true,
        })),
      skipDuplicates: true,
    });
    for (const skill of DEMO_SKILLS) {
      if (await tx.skillTag.findUnique({ where: { name: skill.name } })) continue;
      await tx.skillTag.create({
        data: {
          name: skill.name,
          description: skill.description,
          equipmentModels: skill.models,
          isDemo: true,
          users: {
            createMany: {
              data: skill.engineers
                .map((name) => userId.get(demoEmail(name)))
                .filter((id): id is string => !!id)
                .map((id) => ({ userId: id })),
            },
          },
        },
      });
    }
  }

  /** Replaces any existing demo data with a fresh copy. Returns the shared demo password (shown once). */
  async load(
    actor: DemoActor,
    ip?: string | null,
  ): Promise<{
    password: string;
    logins: { name: string; email: string; role: string }[];
    counts: DemoCounts;
  }> {
    await this.assertNotDemoActor(actor);
    const data = buildDemoData(new Date());
    const password = demoPassword();
    const passwordHash = await hashPassword(password);

    await this.prisma.$transaction(
      async (tx) => {
        await this.deleteDemo(tx);

        // Reuse regions an admin already created with the same name.
        const regionIds = new Map<string, string>();
        for (const name of DEMO_REGIONS) {
          const existing = await tx.region.findUnique({ where: { name } });
          const region = existing ?? (await tx.region.create({ data: { name, isDemo: true } }));
          regionIds.set(name, region.id);
        }

        const takenEmails = new Set(
          (
            await tx.user.findMany({
              where: { email: { in: DEMO_USERS.map((u) => demoEmail(u.name)) } },
              select: { email: true },
            })
          ).map((u) => u.email),
        );
        await tx.user.createMany({
          data: DEMO_USERS.filter((u) => !takenEmails.has(demoEmail(u.name))).map((u) => ({
            name: u.name,
            email: demoEmail(u.name),
            role: u.role,
            regionId: u.region ? regionIds.get(u.region) : null,
            status: 'ACTIVE' as const,
            passwordHash,
            passwordChangedAt: new Date(),
            isDemo: true,
          })),
        });

        await this.seedServiceRules(tx, regionIds);

        const now = new Date();
        for (const customer of data.customers) {
          await tx.customer.create({
            data: {
              ...DEMO,
              name: customer.name,
              customerGroup: customer.customerGroup,
              territory: customer.territory,
              taxId: customer.taxId,
              mobile: customer.mobile,
              email: customer.email,
              syncedAt: now,
              sites: { createMany: { data: customer.sites.map((site) => ({ ...DEMO, ...site })) } },
              contacts: {
                createMany: { data: customer.contacts.map((contact) => ({ ...DEMO, ...contact })) },
              },
              equipment: {
                createMany: {
                  data: customer.machines.map((machine) => ({
                    ...DEMO,
                    ...machine,
                    erpStatus: 'Delivered',
                  })),
                },
              },
            },
          });
        }
        await tx.item.createMany({ data: data.items.map((item) => ({ ...DEMO, ...item })) });
        await tx.itemPrice.createMany({
          data: data.prices.map((price) => ({ ...DEMO, ...price, currency: 'INR' })),
        });
        await tx.warehouse.createMany({
          data: DEMO_WAREHOUSES.map((name) => ({ ...DEMO, name, company: DEMO_COMPANY.name })),
        });
        await tx.stockLevel.createMany({ data: data.stock.map((row) => ({ ...DEMO, ...row })) });

        if (!(await tx.appSetting.findUnique({ where: { key: 'company' } }))) {
          await this.settings.setCompany(DEMO_COMPANY, tx);
        }
      },
      { timeout: 60_000 },
    );

    const counts = await this.counts();
    await this.audit.record({
      actorId: actor.id,
      action: 'demo.loaded',
      entityType: 'demo',
      summary: `${actor.name} loaded demo data: ${counts.customers} customers, ${counts.machines} machines, ${counts.users} demo users`,
      ip: ip ?? null,
    });
    return {
      password,
      logins: DEMO_USERS.map((u) => ({ name: u.name, email: demoEmail(u.name), role: u.role })),
      counts,
    };
  }

  async clear(actor: DemoActor, confirmation: string, ip?: string | null): Promise<DemoCounts> {
    if (confirmation !== CLEAR_CONFIRMATION) {
      throw new AppException(
        'CONFIRMATION_MISMATCH',
        `Type ${CLEAR_CONFIRMATION} to confirm.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ field: 'confirm', message: `Type ${CLEAR_CONFIRMATION} exactly.` }],
      );
    }
    await this.assertNotDemoActor(actor);
    const before = await this.counts();
    await this.prisma.$transaction((tx) => this.deleteDemo(tx), { timeout: 60_000 });
    await this.audit.record({
      actorId: actor.id,
      action: 'demo.cleared',
      entityType: 'demo',
      summary: `${actor.name} cleared demo data (${before.customers} customers, ${before.machines} machines, ${before.users} demo users)`,
      ip: ip ?? null,
    });
    return before;
  }
}
