import { Prisma } from '@prisma/client';

/** A raw ERPNext document (`fields: ["*"]`), read defensively: v14 and v15 differ. */
export type ErpDoc = Record<string, unknown> & { name: string; modified?: string };

export type MirrorTable =
  | 'customer'
  | 'customerContact'
  | 'site'
  | 'equipment'
  | 'item'
  | 'itemPrice'
  | 'warehouse'
  | 'stockLevel';

export interface SyncSpec {
  doctype: string;
  table: MirrorTable;
  /** Plural noun for summaries, e.g. "customers". */
  label: string;
  /** Row data from one ERP document (without source/connection/erpName keys). */
  map: (doc: ErpDoc, links: Map<string, string>) => Record<string, unknown>;
  /** Linked to customers through Dynamic Link (Address, Contact). */
  customerLinked?: boolean;
  /** Changes too often for webhooks; synced by the catch-up only. */
  catchUpOnly?: boolean;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim()
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : null;
const bool = (value: unknown): boolean => value === 1 || value === true || value === '1';
const num = (value: unknown): Prisma.Decimal =>
  new Prisma.Decimal(typeof value === 'number' || typeof value === 'string' ? value || 0 : 0);
/** Frappe dates are "YYYY-MM-DD"; timestamps "YYYY-MM-DD HH:MM:SS.ffffff" in the site's timezone. */
const date = (value: unknown): Date | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)
    ? new Date(`${value.slice(0, 10)}T00:00:00Z`)
    : null;

export function erpTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value.replace(' ', 'T').replace(/(\.\d{3})\d+$/, '$1'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Order matters: customers first, so addresses, contacts and machines can link to them. */
export const SYNC_SPECS: SyncSpec[] = [
  {
    doctype: 'Customer',
    table: 'customer',
    label: 'customers',
    map: (doc) => ({
      name: str(doc.customer_name) ?? doc.name,
      customerGroup: str(doc.customer_group),
      territory: str(doc.territory),
      taxId: str(doc.gstin) ?? str(doc.tax_id),
      mobile: str(doc.mobile_no),
      email: str(doc.email_id),
      active: !bool(doc.disabled),
    }),
  },
  {
    doctype: 'Address',
    table: 'site',
    label: 'sites',
    customerLinked: true,
    map: (doc, links) => ({
      title: str(doc.address_title) ?? doc.name,
      line1: str(doc.address_line1),
      line2: str(doc.address_line2),
      city: str(doc.city),
      state: str(doc.state),
      pincode: str(doc.pincode),
      country: str(doc.country),
      gstin: str(doc.gstin),
      customerErpName: links.get(doc.name) ?? null,
      active: !bool(doc.disabled),
    }),
  },
  {
    doctype: 'Contact',
    table: 'customerContact',
    label: 'contacts',
    customerLinked: true,
    map: (doc, links) => ({
      fullName:
        (str(doc.full_name) ??
          [str(doc.first_name), str(doc.last_name)].filter(Boolean).join(' ')) ||
        doc.name,
      email: str(doc.email_id),
      mobile: str(doc.mobile_no),
      phone: str(doc.phone),
      isPrimary: bool(doc.is_primary_contact),
      customerErpName: links.get(doc.name) ?? null,
      active: str(doc.status) !== 'Passive',
    }),
  },
  {
    doctype: 'Serial No',
    table: 'equipment',
    label: 'machines',
    map: (doc) => ({
      serialNo: str(doc.serial_no) ?? doc.name,
      itemCode: str(doc.item_code),
      itemName: str(doc.item_name),
      customerErpName: str(doc.customer),
      erpStatus: str(doc.status),
      warrantyExpiresOn: date(doc.warranty_expiry_date),
      amcExpiresOn: date(doc.amc_expiry_date),
      active: true,
    }),
  },
  {
    doctype: 'Item',
    table: 'item',
    label: 'items',
    map: (doc) => ({
      itemCode: str(doc.item_code) ?? doc.name,
      name: str(doc.item_name) ?? doc.name,
      itemGroup: str(doc.item_group),
      uom: str(doc.stock_uom),
      isStockItem: bool(doc.is_stock_item),
      active: !bool(doc.disabled),
    }),
  },
  {
    doctype: 'Item Price',
    table: 'itemPrice',
    label: 'prices',
    map: (doc) => ({
      itemCode: str(doc.item_code) ?? '',
      priceList: str(doc.price_list) ?? '',
      rate: num(doc.price_list_rate),
      currency: str(doc.currency) ?? 'INR',
      selling: bool(doc.selling),
      buying: bool(doc.buying),
      active: true,
    }),
  },
  {
    doctype: 'Warehouse',
    table: 'warehouse',
    label: 'warehouses',
    map: (doc) => ({
      name: str(doc.warehouse_name) ?? doc.name,
      company: str(doc.company),
      isGroup: bool(doc.is_group),
      active: !bool(doc.disabled),
    }),
  },
  {
    doctype: 'Bin',
    table: 'stockLevel',
    label: 'stock levels',
    catchUpOnly: true,
    map: (doc) => ({
      itemCode: str(doc.item_code) ?? '',
      warehouse: str(doc.warehouse) ?? '',
      actualQty: num(doc.actual_qty),
      projectedQty: num(doc.projected_qty),
    }),
  },
];

export const WEBHOOK_DOCTYPES = SYNC_SPECS.filter((spec) => !spec.catchUpOnly).map(
  (spec) => spec.doctype,
);

export function specFor(doctype: string): SyncSpec | undefined {
  return SYNC_SPECS.find((spec) => spec.doctype === doctype);
}
