import { erpTimestamp, specFor, WEBHOOK_DOCTYPES } from './specs';

const map = (doctype: string, doc: Record<string, unknown>, links = new Map<string, string>()) =>
  specFor(doctype)!.map({ name: 'N-1', ...doc }, links);

describe('sync specs', () => {
  it('maps a customer, preferring GSTIN over tax id and turning disabled into inactive', () => {
    expect(
      map('Customer', {
        customer_name: 'Ridgeway Aggregates',
        gstin: '29ABCDE1234F1Z5',
        tax_id: 'x',
        disabled: 1,
      }),
    ).toMatchObject({ name: 'Ridgeway Aggregates', taxId: '29ABCDE1234F1Z5', active: false });
  });

  it('links an address to its customer through Dynamic Link', () => {
    expect(
      map(
        'Address',
        { address_title: 'Hosur plant', pincode: '635109' },
        new Map([['N-1', 'CUST-001']]),
      ),
    ).toMatchObject({
      title: 'Hosur plant',
      pincode: '635109',
      customerErpName: 'CUST-001',
    });
  });

  it('builds a contact name when full_name is missing (older ERPNext)', () => {
    expect(map('Contact', { first_name: 'Sanjay', last_name: 'Gowda' }).fullName).toBe(
      'Sanjay Gowda',
    );
  });

  it('reads serial number dates as dates and tolerates a missing customer field (v15)', () => {
    const row = map('Serial No', {
      serial_no: 'CX400-2311-052',
      warranty_expiry_date: '2027-03-31',
    });
    expect(row.serialNo).toBe('CX400-2311-052');
    expect(row.customerErpName).toBeNull();
    expect((row.warrantyExpiresOn as Date).toISOString()).toBe('2027-03-31T00:00:00.000Z');
  });

  it('keeps prices exact as decimals', () => {
    expect(
      String(
        map('Item Price', {
          price_list_rate: 78400.5,
          item_code: 'CX-ML-01',
          price_list: 'AMC 2026',
        }).rate,
      ),
    ).toBe('78400.5');
  });

  it('never subscribes to stock levels by webhook', () => {
    expect(WEBHOOK_DOCTYPES).not.toContain('Bin');
    expect(WEBHOOK_DOCTYPES).toContain('Serial No');
  });

  it('parses Frappe timestamps with microseconds', () => {
    expect(erpTimestamp('2026-09-24 10:15:03.123456')?.toISOString()).toMatch(/^2026-09-24T/);
    expect(erpTimestamp('nonsense')).toBeNull();
  });
});
