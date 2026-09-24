import { buildDemoData, DEMO_EMAIL_DOMAIN, DEMO_USERS, demoEmail } from './demo-data';

describe('buildDemoData', () => {
  const today = new Date('2026-09-25T00:00:00Z');
  const data = buildDemoData(today);
  const machines = data.customers.flatMap((c) => c.machines);

  it('has the promised size', () => {
    expect(data.customers).toHaveLength(12);
    expect(machines).toHaveLength(40);
    expect(data.items).toHaveLength(30);
    expect(data.prices).toHaveLength(60);
    expect(data.stock).toHaveLength(60);
  });

  it('is deterministic and serial numbers are unique', () => {
    expect(buildDemoData(today)).toEqual(data);
    expect(new Set(machines.map((m) => m.serialNo)).size).toBe(40);
  });

  it('spreads coverage: in warranty, under AMC, AMC expiring within 60 days, and uncovered', () => {
    const inWarranty = machines.filter((m) => m.warrantyExpiresOn && m.warrantyExpiresOn > today);
    const amcSoon = machines.filter(
      (m) =>
        m.amcExpiresOn &&
        m.amcExpiresOn > today &&
        m.amcExpiresOn.getTime() - today.getTime() < 60 * 86_400_000,
    );
    const uncovered = machines.filter(
      (m) => !m.amcExpiresOn && m.warrantyExpiresOn && m.warrantyExpiresOn < today,
    );
    expect(inWarranty.length).toBeGreaterThan(0);
    expect(amcSoon.length).toBeGreaterThan(0);
    expect(uncovered.length).toBeGreaterThan(0);
  });

  it('only uses reserved example domains for email', () => {
    const emails = [
      ...data.customers.flatMap((c) => [c.email, ...c.contacts.map((p) => p.email)]),
      ...DEMO_USERS.map((u) => demoEmail(u.name)),
    ];
    expect(emails.every((email) => email.endsWith('.example'))).toBe(true);
    expect(demoEmail('Meera Iyer')).toBe(`meera.iyer@${DEMO_EMAIL_DOMAIN}`);
  });

  it('includes an out-of-stock spare for demos', () => {
    expect(data.stock.some((s) => s.actualQty.isZero())).toBe(true);
  });
});
