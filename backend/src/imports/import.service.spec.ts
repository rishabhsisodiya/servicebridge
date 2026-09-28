import { ImportService } from './import.service';

const actor = { id: 'u1', name: 'Mira' } as never;
const client = { ip: '127.0.0.1', requestId: 'r1' } as never;

const csvFile = (content: string, name = 'customers.csv') => ({
  originalname: name,
  size: Buffer.byteLength(content),
  buffer: Buffer.from(content, 'utf-8'),
});

const CUSTOMERS_CSV = `name,customer_group,territory,tax_id,mobile,email
Acme Industries,Industrial,West,GSTIN1,9999999999,ops@acme.example
Beta Traders,Retail,East,,8888888888,not-an-email
,Retail,East,,7777777777,ok@beta.example
Acme Industries,Industrial,West,GSTIN1,9999999999,ops@acme.example
`;

const MACHINES_CSV = `serial_no,item_code,item_name,customer_name,warranty_expires_on,amc_expires_on
SN-001,CMP-100,Compressor,Acme Industries,2027-01-15,2026-12-31
SN-002,,,,not-a-date,
SN-001,,,,,
SN-003,,,,,`;

const makeService = (overrides: Record<string, unknown> = {}) => {
  const prisma = {
    customer: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'c-new', ...data }),
      ),
      findUnique: jest.fn(),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'c1', ...data }),
      ),
    },
    equipment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'e-new', ...data }),
      ),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
  const audit = { record: jest.fn() };
  const service = new ImportService(prisma as never, audit as never);
  return { service, prisma, audit };
};

describe('ImportService', () => {
  describe('validate customers', () => {
    it('classifies rows as valid, warning (matched) and error', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findMany as jest.Mock).mockResolvedValue([
        { id: 'c1', name: 'Acme Industries', taxId: 'GSTIN1' },
      ]);
      const preview = await service.validate('customers', csvFile(CUSTOMERS_CSV));
      expect(preview.summary).toEqual({ valid: 0, warning: 1, error: 3 });
      const [acme, beta, noname, dupe] = preview.rows;
      expect(acme.status).toBe('warning');
      expect(acme.matchedExisting).toEqual({ id: 'c1', name: 'Acme Industries' });
      expect(acme.defaultMode).toBe('update-fill');
      expect(beta.status).toBe('error');
      expect(beta.errors.join(' ')).toContain('email');
      expect(noname.errors.join(' ')).toContain('name is required');
      expect(dupe.errors.join(' ')).toContain('Duplicate customer name');
    });

    it('matches on tax_id when the name differs', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findMany as jest.Mock).mockResolvedValue([
        { id: 'c1', name: 'Acme Ltd', taxId: 'GSTIN1' },
      ]);
      const preview = await service.validate(
        'customers',
        csvFile('name,customer_group,territory,tax_id,mobile,email\nAcme Industries,,,GSTIN1,,\n'),
      );
      expect(preview.rows[0].status).toBe('warning');
      expect(preview.rows[0].matchedExisting?.id).toBe('c1');
    });

    it('rejects non-csv files and oversized payloads', async () => {
      const { service } = makeService();
      await expect(service.validate('customers', csvFile('a,b\n1,2\n', 'data.txt'))).rejects.toMatchObject(
        { code: 'VALIDATION_FAILED' },
      );
      await expect(
        service.validate('customers', { originalname: 'a.csv', size: 6 * 1024 * 1024, buffer: Buffer.from('x') }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('rejects a missing required column', async () => {
      const { service } = makeService();
      await expect(
        service.validate('customers', csvFile('customer_group\nIndustrial\n')),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('validate machines', () => {
    it('requires customer_name to match an existing customer', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findMany as jest.Mock).mockResolvedValue([
        { id: 'c1', name: 'Acme Industries' },
      ]);
      const preview = await service.validate('equipment', csvFile(MACHINES_CSV));
      // SN-001 valid; SN-002 bad date; SN-001 duplicate serial; SN-003 valid (no customer).
      expect(preview.summary).toEqual({ valid: 2, warning: 0, error: 2 });
      expect(preview.rows[1].errors.join(' ')).toContain('YYYY-MM-DD');
      expect(preview.rows[2].errors.join(' ')).toContain('Duplicate serial_no');
    });

    it('errors when customer_name matches nothing', async () => {
      const { service } = makeService();
      const preview = await service.validate(
        'equipment',
        csvFile('serial_no,item_code,item_name,customer_name\nSN-9,,,Ghost Co\n'),
      );
      expect(preview.rows[0].status).toBe('error');
      expect(preview.rows[0].errors.join(' ')).toContain('Import the customer first');
    });
  });

  describe('confirm', () => {
    it('creates valid rows and skips error rows', async () => {
      const { service, prisma, audit } = makeService();
      const preview = await service.validate(
        'customers',
        csvFile('name,customer_group,territory,tax_id,mobile,email\nNew Co,Retail,East,,111,ok@new.example\n,Retail,East,,222,bad@new.example\n'),
      );
      const report = await service.confirm(
        'customers',
        { validationId: preview.validationId },
        actor,
        client,
      );
      expect(report).toEqual({ created: 1, updated: 0, skipped: 1, errors: [] });
      expect(prisma.customer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ source: 'IMPORT', name: 'New Co' }) }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'import.customers', actorId: 'u1' }),
      );
    });

    it('update-fill only fills blanks, never overwrites', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findMany as jest.Mock).mockResolvedValue([
        { id: 'c1', name: 'Acme Industries', taxId: 'GSTIN1' },
      ]);
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        name: 'Acme Industries',
        customerGroup: 'Industrial',
        territory: null,
        taxId: 'GSTIN1',
        mobile: '9999999999',
        email: null,
      });
      const preview = await service.validate(
        'customers',
        csvFile('name,customer_group,territory,tax_id,mobile,email\nAcme Industries,Changed,West,GSTIN1,0000000000,new@acme.example\n'),
      );
      expect(preview.rows[0].defaultMode).toBe('update-fill');
      await service.confirm('customers', { validationId: preview.validationId }, actor, client);
      const data = (prisma.customer.update as jest.Mock).mock.calls[0][0].data;
      // territory/email were blank → filled; group/mobile had values → kept.
      expect(data).toEqual({ territory: 'West', email: 'new@acme.example' });
    });

    it('honours per-row mode overrides', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findMany as jest.Mock).mockResolvedValue([
        { id: 'c1', name: 'Acme Industries', taxId: null },
      ]);
      (prisma.customer.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        name: 'Acme Industries',
        customerGroup: 'Industrial',
        territory: null,
        taxId: null,
        mobile: null,
        email: null,
      });
      const preview = await service.validate(
        'customers',
        csvFile('name,customer_group,territory,tax_id,mobile,email\nAcme Industries,Changed,West,,,,\n'),
      );
      await service.confirm(
        'customers',
        { validationId: preview.validationId, rows: [{ index: 1, mode: 'update-overwrite' }] },
        actor,
        client,
      );
      const data = (prisma.customer.update as jest.Mock).mock.calls[0][0].data;
      expect(data.customerGroup).toBe('Changed');
    });

    it('rejects an unknown or expired validation id', async () => {
      const { service } = makeService();
      await expect(
        service.confirm('customers', { validationId: 'imp_nope' }, actor, client),
      ).rejects.toMatchObject({ code: 'VALIDATION_EXPIRED' });
    });

    it('rejects a validation id held for the other entity', async () => {
      const { service } = makeService();
      const preview = await service.validate(
        'customers',
        csvFile('name\nSolo\n'),
      );
      await expect(
        service.confirm('equipment', { validationId: preview.validationId }, actor, client),
      ).rejects.toMatchObject({ code: 'VALIDATION_EXPIRED' });
    });

    it('creates machines with parsed dates and customer links', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findMany as jest.Mock).mockResolvedValue([
        { id: 'c1', name: 'Acme Industries' },
      ]);
      const preview = await service.validate(
        'equipment',
        csvFile('serial_no,item_code,item_name,customer_name,warranty_expires_on\nSN-100,CMP-1,Compressor,Acme Industries,2027-01-15\n'),
      );
      const report = await service.confirm(
        'equipment',
        { validationId: preview.validationId },
        actor,
        client,
      );
      expect(report.created).toBe(1);
      const data = (prisma.equipment.create as jest.Mock).mock.calls[0][0].data;
      expect(data).toMatchObject({
        source: 'IMPORT',
        serialNo: 'SN-100',
        customerId: 'c1',
        warrantyExpiresOn: new Date('2027-01-15T00:00:00Z'),
      });
    });
  });
});
