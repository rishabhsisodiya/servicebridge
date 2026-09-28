import { FrappeRestClient } from '../adapters/frappe-rest.client';
import { SB_REF_FIELD } from '../connection-tester';
import {
  INVOICE_KEY,
  STOCK_ENTRY_KEY,
  WritebacksService,
} from './writebacks.service';

const SETTINGS = {
  invoiceTriggers: ['close'] as ('close' | 'verify')[],
  defaultWarehouseId: 'wh-1',
  stockEntryAsDraft: true,
  invoiceTaxTemplate: null,
};

function mocks() {
  const prisma = {
    erpWriteback: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ticket: { findUnique: jest.fn() },
    visit: { findUnique: jest.fn() },
    warehouse: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    automationSetting: { findUnique: jest.fn() },
  };
  const add = jest.fn().mockResolvedValue({});
  const queues = { queue: jest.fn().mockReturnValue({ add }) };
  const handlers: Record<string, (ctx: never) => Promise<string>> = {};
  const automations = {
    define: jest.fn((def: Record<string, unknown>, handler: (ctx: never) => Promise<string>) => {
      handlers[def.key as string] = handler;
    }),
    isEnabled: jest.fn().mockResolvedValue(true),
  };
  const audit = { record: jest.fn() };
  const settings = {
    writebacks: jest.fn().mockResolvedValue({ ...SETTINGS }),
    updateWritebackSettings: jest.fn(),
  };
  const connections = {
    purposes: jest.fn().mockResolvedValue({ MASTER_SYNC: null, WRITEBACK: 'conn-1' }),
    probeForSetup: jest.fn().mockResolvedValue({
      view: { id: 'conn-1', name: 'ERP', status: 'ACTIVE' },
      result: { readyFor: ['WRITEBACK'], setup: { missingFields: [] } },
      credentials: { baseUrl: 'https://erp.example.com', apiKey: 'k', apiSecret: 's' },
      allowPrivateHosts: false,
    }),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const service = new WritebacksService(
    prisma as never,
    queues as never,
    automations as never,
    audit as never,
    settings as never,
    connections as never,
    notifications as never,
  );
  service.onModuleInit();
  return { prisma, queues, add, automations, handlers, audit, settings, connections, notifications, service };
}

const invoiceRow = (overrides = {}) => ({
  id: 'wb-1',
  type: 'INVOICE',
  status: 'PENDING',
  ticketId: 'ticket-1',
  visitId: null,
  idempotencyKey: 'invoice-ticket-1',
  erpDocType: 'Sales Invoice',
  erpDocName: null,
  attempts: 0,
  error: null,
  createdById: 'user-1',
  ...overrides,
});

const ticketWithQuotation = (overrides = {}) => ({
  number: 'SB-26-000001',
  coverage: 'CHARGEABLE',
  customer: { name: 'Acme Ltd', erpName: 'ACME-001' },
  quotations: [
    {
      id: 'q-1',
      number: 'QT-26-000001',
      poNumber: 'PO-77',
      lines: [
        { quantity: 2, rate: 100, item: { itemCode: 'SP-001', name: 'Bearing' } },
        { quantity: 1, rate: 50, item: { itemCode: 'SP-002', name: 'Seal' } },
      ],
    },
  ],
  ...overrides,
});

const jobCtx = (writebackId: string, attemptsMade = 0) => ({
  job: { data: { automationKey: INVOICE_KEY, trigger: 'EVENT', writebackId }, attemptsMade },
  trigger: 'EVENT',
  params: {},
  log: async () => {},
});

describe('WritebacksService automations', () => {
  it('defines one off-by-default automation per write-back type', () => {
    const { automations } = mocks();
    expect(automations.define).toHaveBeenCalledTimes(2);
    const defs = automations.define.mock.calls.map((c) => c[0]);
    expect(defs.map((d) => d.key).sort()).toEqual(
      [INVOICE_KEY, STOCK_ENTRY_KEY].sort(),
    );
    for (const d of defs) {
      expect(d.defaultEnabled).toBe(false);
      expect(d.kind).toBe('event');
      expect(d.queue).toBe('erp-writeback');
    }
  });
});

describe('onTicketAction', () => {
  it('queues an invoice job with a fixed job id and the approved retry policy', async () => {
    const { service, add, prisma } = mocks();
    prisma.erpWriteback.findUnique.mockResolvedValue(null);
    prisma.erpWriteback.upsert.mockResolvedValue(invoiceRow());

    await service.onTicketAction('close', { id: 'ticket-1', number: 'SB-26-1' }, 'user-1');

    expect(add).toHaveBeenCalledWith(
      INVOICE_KEY,
      expect.objectContaining({ automationKey: INVOICE_KEY, writebackId: 'wb-1' }),
      {
        jobId: 'writeback-invoice-ticket-1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
  });

  it('ignores actions outside the configured triggers', async () => {
    const { service, add } = mocks();
    await service.onTicketAction('resolve', { id: 't', number: 'n' }, 'u');
    await service.onTicketAction('verify', { id: 't', number: 'n' }, 'u');
    expect(add).not.toHaveBeenCalled();
  });

  it('does nothing when the automation is switched off', async () => {
    const { service, add, automations } = mocks();
    automations.isEnabled.mockResolvedValue(false);
    await service.onTicketAction('close', { id: 't', number: 'n' }, 'u');
    expect(add).not.toHaveBeenCalled();
  });

  it('never re-queues a succeeded write-back', async () => {
    const { service, add, prisma } = mocks();
    prisma.erpWriteback.findUnique.mockResolvedValue(invoiceRow({ status: 'SUCCEEDED' }));
    await service.onTicketAction('close', { id: 'ticket-1', number: 'n' }, 'u');
    expect(add).not.toHaveBeenCalled();
    expect(prisma.erpWriteback.upsert).not.toHaveBeenCalled();
  });

  it('never throws: a Redis outage must not block ticket work', async () => {
    const { service, queues } = mocks();
    queues.queue.mockReturnValue({ add: jest.fn().mockRejectedValue(new Error('redis down')) });
    await expect(
      service.onTicketAction('close', { id: 't', number: 'n' }, 'u'),
    ).resolves.toBeUndefined();
  });
});

describe('invoice worker', () => {
  beforeEach(() => {
    jest.spyOn(FrappeRestClient.prototype, 'getDoc').mockResolvedValue({ name: 'ACME-001' });
    jest.spyOn(FrappeRestClient.prototype, 'list').mockResolvedValue([]);
    jest.spyOn(FrappeRestClient.prototype, 'create').mockResolvedValue({ name: 'SINV-0001' });
    jest.spyOn(FrappeRestClient.prototype, 'close').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const runInvoice = (
    m: ReturnType<typeof mocks>,
    rowOverrides = {},
    attemptsMade = 0,
    ticketOverrides = {},
  ) => {
    m.prisma.erpWriteback.findUnique.mockResolvedValue(invoiceRow(rowOverrides));
    m.prisma.ticket.findUnique.mockResolvedValue(ticketWithQuotation(ticketOverrides));
    return m.handlers[INVOICE_KEY](jobCtx('wb-1', attemptsMade) as never);
  };

  it('creates a draft invoice from the quotation lines and marks the row succeeded', async () => {
    const m = mocks();
    const summary = await runInvoice(m);

    expect(FrappeRestClient.prototype.create).toHaveBeenCalledWith(
      'Sales Invoice',
      expect.objectContaining({
        customer: 'ACME-001',
        docstatus: 0,
        [SB_REF_FIELD]: 'invoice-ticket-1',
        po_no: 'PO-77',
      }),
    );
    const doc = (FrappeRestClient.prototype.create as jest.Mock).mock.calls[0][1];
    expect(doc.items).toEqual([
      expect.objectContaining({ item_code: 'SP-001', qty: 2, rate: 100 }),
      expect.objectContaining({ item_code: 'SP-002', qty: 1, rate: 50 }),
    ]);
    const updates = m.prisma.erpWriteback.update.mock.calls.map((c: unknown[]) => c[0]);
    expect(updates).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({ erpDocName: 'SINV-0001' }),
      }),
    );
    expect(m.prisma.erpWriteback.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'wb-1' },
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
    );
    expect(summary).toMatch('draft');
  });

  it('zeroes the bill when the ticket is AMC-covered', async () => {
    const m = mocks();
    m.prisma.erpWriteback.findUnique.mockResolvedValue(invoiceRow());
    m.prisma.ticket.findUnique.mockResolvedValue(ticketWithQuotation({ coverage: 'AMC' }));

    await m.handlers[INVOICE_KEY](jobCtx('wb-1') as never);

    const doc = (FrappeRestClient.prototype.create as jest.Mock).mock.calls[0][1] as {
      items: { rate: number }[];
    };
    expect(doc.items.every((i) => i.rate === 0)).toBe(true);
  });

  it('fails loudly when the customer is not linked to the ERP', async () => {
    const m = mocks();

    await expect(
      runInvoice(m, {}, 0, { customer: { name: 'Acme Ltd', erpName: null } }),
    ).rejects.toMatchObject({ code: 'WRITEBACK_CUSTOMER_NOT_FOUND' });
    expect(FrappeRestClient.prototype.create).not.toHaveBeenCalled();
  });

  it('fails when there is no sent quotation', async () => {
    const m = mocks();

    await expect(runInvoice(m, {}, 0, { quotations: [] })).rejects.toMatchObject({
      code: 'WRITEBACK_NO_QUOTATION',
    });
  });

  it('fails closed when no connection is assigned to write-backs', async () => {
    const m = mocks();
    m.connections.purposes.mockResolvedValue({ MASTER_SYNC: null, WRITEBACK: null });

    await expect(runInvoice(m)).rejects.toMatchObject({ code: 'WRITEBACK_NOT_CONFIGURED' });
    expect(FrappeRestClient.prototype.create).not.toHaveBeenCalled();
  });

  it('reuses the existing ERP document on the idempotent pre-search', async () => {
    const m = mocks();
    (FrappeRestClient.prototype.list as jest.Mock).mockResolvedValue([{ name: 'SINV-0099' }]);

    const summary = await runInvoice(m);

    expect(FrappeRestClient.prototype.create).not.toHaveBeenCalled();
    expect(summary).toMatch('SINV-0099');
  });

  it('marks FAILED and notifies on the last attempt, keeps PROCESSING otherwise', async () => {
    const m = mocks();
    m.prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1' }]);
    (FrappeRestClient.prototype.create as jest.Mock).mockRejectedValue(new Error('ERP timeout'));

    await expect(runInvoice(m, {}, 4)).rejects.toThrow('ERP timeout');
    expect(m.prisma.erpWriteback.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'wb-1' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(m.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'WRITEBACK_FAILED' }),
    );

    const m2 = mocks();
    m2.prisma.erpWriteback.findUnique.mockResolvedValue(invoiceRow());
    m2.prisma.ticket.findUnique.mockResolvedValue(ticketWithQuotation());
    (FrappeRestClient.prototype.create as jest.Mock).mockRejectedValue(new Error('ERP timeout'));
    await expect(
      m2.handlers[INVOICE_KEY](jobCtx('wb-1', 0) as never),
    ).rejects.toThrow('ERP timeout');
    expect(m2.prisma.erpWriteback.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'wb-1' },
        data: expect.objectContaining({ status: 'PROCESSING' }),
      }),
    );
    expect(m2.notifications.notify).not.toHaveBeenCalled();
  });
});

describe('stock-entry worker', () => {
  beforeEach(() => {
    jest.spyOn(FrappeRestClient.prototype, 'list').mockResolvedValue([]);
    jest.spyOn(FrappeRestClient.prototype, 'create').mockResolvedValue({ name: 'STE-0001' });
    jest.spyOn(FrappeRestClient.prototype, 'close').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const stockRow = (overrides = {}) => ({
    id: 'wb-2',
    type: 'STOCK_ENTRY',
    status: 'PENDING',
    ticketId: null,
    visitId: 'visit-1',
    idempotencyKey: 'stock-entry-visit-1',
    erpDocType: 'Stock Entry',
    erpDocName: null,
    attempts: 0,
    error: null,
    createdById: 'user-1',
    ...overrides,
  });

  const visitWith = (spares: { itemCode: string; isStockItem: boolean; quantity: number }[]) => ({
    visitNumber: 1,
    ticket: { number: 'SB-26-000001' },
    spares: spares.map((s) => ({
      quantity: s.quantity,
      item: { itemCode: s.itemCode, name: s.itemCode, isStockItem: s.isStockItem },
    })),
  });

  const runStock = (m: ReturnType<typeof mocks>) =>
    m.handlers[STOCK_ENTRY_KEY]({
      job: {
        data: { automationKey: STOCK_ENTRY_KEY, trigger: 'EVENT', writebackId: 'wb-2' },
        attemptsMade: 0,
      },
      trigger: 'EVENT',
      params: {},
      log: async () => {},
    } as never);

  it('posts stock spares and skips non-stock spares', async () => {
    const m = mocks();
    m.prisma.erpWriteback.findUnique.mockResolvedValue(stockRow());
    m.prisma.visit.findUnique.mockResolvedValue(
      visitWith([
        { itemCode: 'SP-001', isStockItem: true, quantity: 2 },
        { itemCode: 'LABOUR', isStockItem: false, quantity: 3 },
      ]),
    );
    m.prisma.warehouse.findUnique.mockResolvedValue({
      id: 'wh-1',
      name: 'Main',
      erpName: 'Stores - SB',
      active: true,
    });

    await runStock(m);

    const doc = (FrappeRestClient.prototype.create as jest.Mock).mock.calls[0][1];
    expect(doc.stock_entry_type).toBe('Material Issue');
    expect(doc.docstatus).toBe(0);
    expect(doc.items).toEqual([
      expect.objectContaining({ item_code: 'SP-001', qty: 2, s_warehouse: 'Stores - SB' }),
    ]);
  });

  it('succeeds without posting when no spares are stock items', async () => {
    const m = mocks();
    m.prisma.erpWriteback.findUnique.mockResolvedValue(stockRow());
    m.prisma.visit.findUnique.mockResolvedValue(
      visitWith([{ itemCode: 'LABOUR', isStockItem: false, quantity: 3 }]),
    );

    const summary = await runStock(m);

    expect(FrappeRestClient.prototype.create).not.toHaveBeenCalled();
    expect(summary).toMatch('No stock spares');
  });

  it('fails closed when no default warehouse is configured', async () => {
    const m = mocks();
    m.settings.writebacks.mockResolvedValue({ ...SETTINGS, defaultWarehouseId: null });
    m.prisma.erpWriteback.findUnique.mockResolvedValue(stockRow());
    m.prisma.visit.findUnique.mockResolvedValue(
      visitWith([{ itemCode: 'SP-001', isStockItem: true, quantity: 1 }]),
    );

    await expect(runStock(m)).rejects.toMatchObject({ code: 'WRITEBACK_NO_WAREHOUSE' });
  });
});

describe('setupCheck', () => {
  it('fails closed with no connection assigned', async () => {
    const { service, connections } = mocks();
    connections.purposes.mockResolvedValue({ MASTER_SYNC: null, WRITEBACK: null });

    const check = await service.setupCheck();

    expect(check.ok).toBe(false);
    expect(check.connection).toBeNull();
  });

  it('passes when the connection is active, ready and the fields exist', async () => {
    const { service } = mocks();
    const check = await service.setupCheck();

    expect(check.ok).toBe(true);
    expect(check.connection).toMatchObject({ id: 'conn-1', status: 'ACTIVE' });
    expect(check.missingFields).toEqual([]);
  });

  it('lists missing custom fields with copy-paste instructions', async () => {
    const { service, connections } = mocks();
    connections.probeForSetup.mockResolvedValue({
      view: { id: 'conn-1', name: 'ERP', status: 'ACTIVE' },
      result: {
        readyFor: ['WRITEBACK'],
        setup: { missingFields: [{ doctype: 'Stock Entry', fieldname: SB_REF_FIELD }] },
      },
      credentials: { baseUrl: 'https://erp.example.com', apiKey: 'k', apiSecret: 's' },
      allowPrivateHosts: false,
    });

    const check = await service.setupCheck();

    expect(check.ok).toBe(false);
    expect(check.missingFields).toEqual([{ doctype: 'Stock Entry', fieldname: SB_REF_FIELD }]);
    expect(check.fieldInstructions).toMatch('custom_sb_ref');
  });
});

describe('retry', () => {
  it('re-queues a failed write-back and audits it', async () => {
    const { service, add, audit, prisma } = mocks();
    prisma.erpWriteback.findUnique.mockResolvedValue(invoiceRow({ status: 'FAILED' }));
    prisma.erpWriteback.update.mockResolvedValue(invoiceRow({ status: 'PENDING' }));

    await service.retry(
      { id: 'user-1', name: 'Sam' } as never,
      'wb-1',
      { ip: '127.0.0.1', requestId: 'r1' } as never,
    );

    expect(prisma.erpWriteback.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wb-1' },
        data: expect.objectContaining({ status: 'PENDING' }),
      }),
    );
    expect(add).toHaveBeenCalledWith(
      INVOICE_KEY,
      expect.anything(),
      expect.objectContaining({ jobId: 'writeback-invoice-ticket-1' }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'erp.writeback_retried' }),
    );
  });

  it('refuses to retry a write-back that did not fail', async () => {
    const { service, prisma } = mocks();
    prisma.erpWriteback.findUnique.mockResolvedValue(invoiceRow({ status: 'SUCCEEDED' }));

    await expect(
      service.retry({ id: 'u', name: 'n' } as never, 'wb-1', {} as never),
    ).rejects.toMatchObject({ code: 'WRITEBACK_NOT_FAILED' });
  });
});

describe('warehouses', () => {
  it('rejects a blank name and duplicates', async () => {
    const { service, prisma } = mocks();
    prisma.warehouse.findFirst.mockResolvedValue(null);

    await expect(
      service.addWarehouse({ id: 'u', name: 'n' } as never, '  ', {} as never),
    ).rejects.toThrow();

    prisma.warehouse.findFirst.mockResolvedValue({ id: 'wh-9', name: 'Main' });
    await expect(
      service.addWarehouse({ id: 'u', name: 'n' } as never, 'main', {} as never),
    ).rejects.toThrow();
  });

  it('refuses to edit ERP-synced warehouses', async () => {
    const { service, prisma } = mocks();
    prisma.warehouse.findUnique.mockResolvedValue({ id: 'wh-1', source: 'ERP', name: 'Stores' });

    await expect(
      service.updateWarehouse({ id: 'u', name: 'n' } as never, 'wh-1', { name: 'X' }, {} as never),
    ).rejects.toMatchObject({ code: 'WAREHOUSE_SYNCED' });
  });
});
