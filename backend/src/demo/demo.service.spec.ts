import type { AuditService } from '../core/audit/audit.service';
import type { PrismaService } from '../core/prisma/prisma.service';
import { passwordProblems } from '../core/security/password';
import type { AppSettingsService } from './app-settings.service';
import { CLEAR_CONFIRMATION, DemoService, demoPassword } from './demo.service';

function build(actorIsDemo: boolean) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ isDemo: actorIsDemo }) },
    $transaction: jest.fn(),
  };
  return {
    service: new DemoService(
      prisma as unknown as PrismaService,
      {} as AppSettingsService,
      {} as AuditService,
    ),
    prisma,
  };
}

describe('DemoService', () => {
  it('needs the exact confirmation phrase to clear', async () => {
    const { service, prisma } = build(false);
    await expect(
      service.clear({ id: 'a1', name: 'Admin' }, 'delete demo data'),
    ).rejects.toMatchObject({
      code: 'CONFIRMATION_MISMATCH',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses when the person doing it is a demo user (they would delete themselves)', async () => {
    const { service } = build(true);
    await expect(
      service.clear({ id: 'd1', name: 'Demo' }, CLEAR_CONFIRMATION),
    ).rejects.toMatchObject({
      code: 'DEMO_ACTOR',
    });
    await expect(service.load({ id: 'd1', name: 'Demo' })).rejects.toMatchObject({
      code: 'DEMO_ACTOR',
    });
  });

  it('generates demo passwords that pass the password policy', () => {
    for (let i = 0; i < 50; i += 1) expect(passwordProblems(demoPassword())).toEqual([]);
  });
});
