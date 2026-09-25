import { type DutyStatus, Prisma, type Role } from '@prisma/client';

/**
 * Fictional demo company. Every name, email, phone number and GSTIN here is
 * made up; emails use the reserved .example domain. Deterministic: the same
 * input date always produces the same data.
 */

export const DEMO_COMPANY = {
  name: 'Apex Crushing Systems (Demo)',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  gstRatePercent: 18,
};

export const DEMO_EMAIL_DOMAIN = 'apex-demo.example';
export const DEMO_REGIONS = ['North', 'South', 'East', 'West', 'Central'];

export const DEMO_USERS: { name: string; role: Role; region?: string; duty?: DutyStatus }[] = [
  { name: 'Meera Iyer', role: 'SERVICE_MANAGER' },
  { name: 'Rohan Deshpande', role: 'AREA_MANAGER', region: 'South' },
  { name: 'Anita Verghese', role: 'AREA_MANAGER', region: 'Central' },
  { name: 'Farhan Qureshi', role: 'ENGINEER', region: 'South' },
  { name: 'Arjun Menon', role: 'ENGINEER', region: 'South' },
  { name: 'Kiran Shetty', role: 'ENGINEER', region: 'Central' },
  { name: 'Deepa Raghavan', role: 'ENGINEER', region: 'West', duty: 'ON_LEAVE' },
  { name: 'Neha Kulkarni', role: 'ENGINEER', region: 'Central' },
  { name: 'Vikas Rao', role: 'ENGINEER', region: 'East', duty: 'OFF_DUTY' },
  { name: 'Ravi Prakash', role: 'CALL_CENTER' },
  { name: 'Sunita Pillai', role: 'CS_SUPPORT' },
  { name: 'Aditya Malhotra', role: 'EXECUTIVE' },
];

export function demoEmail(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@${DEMO_EMAIL_DOMAIN}`;
}

const CUSTOMERS: {
  name: string;
  group: string;
  region: string;
  city: string;
  state: string;
  pincode: string;
}[] = [
  {
    name: 'Ridgeway Aggregates',
    group: 'Quarry',
    region: 'South',
    city: 'Hosur',
    state: 'Tamil Nadu',
    pincode: '635109',
  },
  {
    name: 'Kaveri Stoneworks',
    group: 'Quarry',
    region: 'South',
    city: 'Mandya',
    state: 'Karnataka',
    pincode: '571401',
  },
  {
    name: 'Northfield Infra',
    group: 'Infrastructure',
    region: 'Central',
    city: 'Nelamangala',
    state: 'Karnataka',
    pincode: '562123',
  },
  {
    name: 'Summit Road Builders',
    group: 'Road construction',
    region: 'Central',
    city: 'Tumakuru',
    state: 'Karnataka',
    pincode: '572101',
  },
  {
    name: 'Tri-Valley Minerals',
    group: 'Mining',
    region: 'Central',
    city: 'Chitradurga',
    state: 'Karnataka',
    pincode: '577501',
  },
  {
    name: 'Blue Mesa Quarries',
    group: 'Quarry',
    region: 'East',
    city: 'Kolar',
    state: 'Karnataka',
    pincode: '563101',
  },
  {
    name: 'Deccan Crushers Co-op',
    group: 'Quarry',
    region: 'North',
    city: 'Belagavi',
    state: 'Karnataka',
    pincode: '590001',
  },
  {
    name: 'Coastal Sand & Stone',
    group: 'Manufactured sand',
    region: 'West',
    city: 'Udupi',
    state: 'Karnataka',
    pincode: '576101',
  },
  {
    name: 'Granite Ridge Projects',
    group: 'Infrastructure',
    region: 'North',
    city: 'Hubballi',
    state: 'Karnataka',
    pincode: '580020',
  },
  {
    name: 'Palar Aggregates',
    group: 'Quarry',
    region: 'South',
    city: 'Vellore',
    state: 'Tamil Nadu',
    pincode: '632001',
  },
  {
    name: 'Western Ghats Minerals',
    group: 'Mining',
    region: 'West',
    city: 'Shivamogga',
    state: 'Karnataka',
    pincode: '577201',
  },
  {
    name: 'Eastline Highways',
    group: 'Road construction',
    region: 'East',
    city: 'Chikkaballapur',
    state: 'Karnataka',
    pincode: '562101',
  },
];

const CONTACT_NAMES = [
  'Sanjay Gowda',
  'Priya Hegde',
  'Mahesh Naik',
  'Lakshmi Rao',
  'Vinod Patil',
  'Asha Kamath',
  'Gopal Reddy',
  'Divya Shenoy',
  'Harish Kumar',
  'Kavya Bhat',
  'Naveen Joshi',
  'Shreya Pai',
];

const MODELS: { code: string; name: string }[] = [
  { code: 'JX-1100', name: 'Jaw Crusher JX-1100' },
  { code: 'CX-400', name: 'Cone Crusher CX-400' },
  { code: 'V-80', name: 'VSI Sand Maker V-80' },
  { code: 'VS-3D', name: 'Vibrating Screen VS-3D' },
  { code: 'MCU-250', name: 'Mobile Crushing Unit MCU-250' },
  { code: 'HMP-120', name: 'Hot Mix Plant 120 TPH' },
  { code: 'BC-800', name: 'Belt Conveyor 800 mm' },
];

const SPARES: { code: string; name: string; group: string; rate: number }[] = [
  { code: 'JX-JD-01', name: 'Fixed jaw die, Mn 14%', group: 'Wear parts', rate: 56800 },
  { code: 'JX-JD-02', name: 'Swing jaw die, Mn 14%', group: 'Wear parts', rate: 58200 },
  { code: 'JX-TP-02', name: 'Toggle plate', group: 'Crusher parts', rate: 24600 },
  { code: 'JX-TS-01', name: 'Toggle seat', group: 'Crusher parts', rate: 9800 },
  { code: 'JX-BR-01', name: 'Eccentric shaft bearing', group: 'Bearings', rate: 142000 },
  { code: 'CX-ML-01', name: 'Mantle liner, Mn 18%', group: 'Wear parts', rate: 78400 },
  { code: 'CX-BL-01', name: 'Bowl liner, Mn 18%', group: 'Wear parts', rate: 91200 },
  { code: 'CX-LP-01', name: 'Lube oil pump', group: 'Lubrication', rate: 38500 },
  { code: 'CX-LF-01', name: 'Lube oil filter element', group: 'Lubrication', rate: 2400 },
  { code: 'CX-TR-01', name: 'Torch ring', group: 'Crusher parts', rate: 6200 },
  { code: 'V8-RT-08', name: 'Rotor tip set (8)', group: 'Wear parts', rate: 42000 },
  { code: 'V8-AP-01', name: 'Anvil plate', group: 'Wear parts', rate: 3900 },
  { code: 'V8-FT-01', name: 'Feed tube', group: 'Wear parts', rate: 11500 },
  { code: 'VS-MS-40', name: 'Screen mesh 40 mm', group: 'Screening', rate: 18600 },
  { code: 'VS-MS-20', name: 'Screen mesh 20 mm', group: 'Screening', rate: 16900 },
  { code: 'VS-SP-01', name: 'Spring set', group: 'Screening', rate: 7400 },
  { code: 'VS-BR-01', name: 'Vibrator bearing', group: 'Bearings', rate: 26800 },
  { code: 'MC-HS-01', name: 'Hydraulic hose kit', group: 'Hydraulics', rate: 14300 },
  { code: 'MC-HP-01', name: 'Hydraulic pump', group: 'Hydraulics', rate: 96500 },
  { code: 'MC-TR-01', name: 'Track roller', group: 'Undercarriage', rate: 21700 },
  { code: 'HM-BN-01', name: 'Burner nozzle assembly', group: 'Burner', rate: 38500 },
  { code: 'HM-IE-01', name: 'Ignition electrode', group: 'Burner', rate: 4200 },
  { code: 'HM-BF-01', name: 'Bag filter (set of 10)', group: 'Filtration', rate: 27500 },
  { code: 'BC-BT-80', name: 'Conveyor belt 800 mm (per m)', group: 'Conveyor', rate: 3100 },
  { code: 'BC-ID-01', name: 'Idler roller', group: 'Conveyor', rate: 1650 },
  { code: 'BC-PL-01', name: 'Pulley lagging kit', group: 'Conveyor', rate: 12800 },
  { code: 'GN-BLT-24', name: 'Hex bolt M24 x 90, 10.9', group: 'Fasteners', rate: 86 },
  { code: 'GN-GRS-01', name: 'EP2 grease (18 kg)', group: 'Lubrication', rate: 5200 },
  { code: 'GN-VB-01', name: 'V-belt B-120', group: 'Drives', rate: 980 },
  { code: 'GN-CP-01', name: 'Jaw coupling', group: 'Drives', rate: 6700 },
];

/** 3-digit pincode prefix → region, from the demo customers' sites (first customer wins). */
export function demoPincodeRules(): { pincodePrefix: string; region: string }[] {
  const rules = new Map<string, string>();
  for (const c of CUSTOMERS) {
    const prefix = c.pincode.slice(0, 3);
    if (!rules.has(prefix)) rules.set(prefix, c.region);
  }
  return [...rules].map(([pincodePrefix, region]) => ({ pincodePrefix, region }));
}

/** Machine skills and the demo engineers who have them. */
export const DEMO_SKILLS: {
  name: string;
  description: string;
  models: string[];
  engineers: string[];
}[] = [
  {
    name: 'Jaw & cone crushers',
    description: 'Liner changes, setting adjustment, bearing and toggle work.',
    models: ['JX-1100', 'CX-400'],
    engineers: ['Farhan Qureshi', 'Kiran Shetty', 'Vikas Rao'],
  },
  {
    name: 'VSI & screening',
    description: 'Rotor balancing, tip replacement, screen mesh and vibrator bearings.',
    models: ['V-80', 'VS-3D'],
    engineers: ['Arjun Menon', 'Neha Kulkarni', 'Deepa Raghavan'],
  },
  {
    name: 'Mobile units & hydraulics',
    description: 'Tracked plants, hydraulic circuits and undercarriage.',
    models: ['MCU-250'],
    engineers: ['Farhan Qureshi', 'Deepa Raghavan'],
  },
  {
    name: 'Asphalt plants',
    description: 'Burners, bag filters and plant controls.',
    models: ['HMP-120'],
    engineers: ['Vikas Rao', 'Neha Kulkarni'],
  },
  {
    name: 'Conveyors',
    description: 'Belt splicing, idlers, pulleys and alignment.',
    models: ['BC-800'],
    engineers: ['Arjun Menon', 'Kiran Shetty', 'Deepa Raghavan', 'Vikas Rao'],
  },
];

export const DEMO_WAREHOUSES = ['Spares – Bengaluru', 'Spares – Hosur'];

const pad = (n: number, width = 3) => String(n).padStart(width, '0');
const addDays = (base: Date, days: number) => {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

export interface DemoData {
  customers: {
    name: string;
    customerGroup: string;
    territory: string;
    taxId: string;
    mobile: string;
    email: string;
    sites: {
      title: string;
      line1: string;
      city: string;
      state: string;
      pincode: string;
      country: string;
    }[];
    contacts: { fullName: string; email: string; mobile: string; isPrimary: boolean }[];
    machines: {
      serialNo: string;
      itemCode: string;
      itemName: string;
      warrantyExpiresOn: Date | null;
      amcExpiresOn: Date | null;
    }[];
  }[];
  items: { itemCode: string; name: string; itemGroup: string; uom: string }[];
  prices: { itemCode: string; priceList: string; rate: Prisma.Decimal }[];
  stock: {
    itemCode: string;
    warehouse: string;
    actualQty: Prisma.Decimal;
    projectedQty: Prisma.Decimal;
  }[];
}

/**
 * 12 customers, 1–2 sites and contacts each, 40 machines with a spread of
 * coverage (in warranty, AMC, expiring soon, expired), 30 spares with two
 * price lists and stock in two warehouses.
 */
export function buildDemoData(today = new Date()): DemoData {
  let machineNo = 0;
  const customers = CUSTOMERS.map((customer, i) => {
    const machineCount = i < 4 ? 5 : i < 8 ? 3 : 2; // 20 + 12 + 8 = 40
    const machines = Array.from({ length: machineCount }, (_, m) => {
      machineNo += 1;
      const model = MODELS[(i + m) % MODELS.length];
      const coverage = machineNo % 5; // 0 warranty, 1–2 AMC, 3 expiring AMC, 4 none
      return {
        serialNo: `${model.code.replace('-', '')}-${2300 + ((machineNo * 7) % 90)}-${pad(machineNo)}`,
        itemCode: model.code,
        itemName: model.name,
        warrantyExpiresOn:
          coverage === 0
            ? addDays(today, 120 + machineNo * 3)
            : addDays(today, -200 - machineNo * 5),
        amcExpiresOn:
          coverage === 1 || coverage === 2
            ? addDays(today, 150 + machineNo * 4)
            : coverage === 3
              ? addDays(today, 20 + machineNo)
              : null,
      };
    });
    const slug = customer.name.toLowerCase().replace(/[^a-z]+/g, '');
    const contactCount = i % 3 === 0 ? 2 : 1;
    return {
      name: customer.name,
      customerGroup: customer.group,
      territory: customer.region,
      // Fictional: valid GSTIN shape, invented PAN part.
      taxId: `${customer.state === 'Tamil Nadu' ? '33' : '29'}AAXC${String.fromCharCode(65 + i)}${pad(4100 + i * 37, 4)}Q1Z${(i % 9) + 1}`,
      mobile: `+91 90000 ${pad(10000 + i * 731, 5)}`,
      email: `service@${slug}.example`,
      sites: [
        {
          title: `${customer.city} plant`,
          line1: `Survey No. ${100 + i * 13}, Industrial Area`,
          city: customer.city,
          state: customer.state,
          pincode: customer.pincode,
          country: 'India',
        },
        ...(i % 4 === 0
          ? [
              {
                title: `${customer.city} yard 2`,
                line1: `Plot ${20 + i}, Quarry Road`,
                city: customer.city,
                state: customer.state,
                pincode: customer.pincode,
                country: 'India',
              },
            ]
          : []),
      ],
      contacts: Array.from({ length: contactCount }, (_, c) => {
        const fullName = CONTACT_NAMES[(i + c * 5) % CONTACT_NAMES.length];
        return {
          fullName,
          email: `${fullName.toLowerCase().replace(/[^a-z]+/g, '.')}@${slug}.example`,
          mobile: `+91 90000 ${pad(20000 + i * 97 + c * 11, 5)}`,
          isPrimary: c === 0,
        };
      }),
      machines,
    };
  });

  const items = SPARES.map((s) => ({
    itemCode: s.code,
    name: s.name,
    itemGroup: s.group,
    uom: s.code.includes('BT') ? 'Meter' : 'Nos',
  }));
  const prices = SPARES.flatMap((s) => [
    { itemCode: s.code, priceList: 'Standard 2026', rate: new Prisma.Decimal(s.rate) },
    { itemCode: s.code, priceList: 'AMC 2026', rate: new Prisma.Decimal(Math.round(s.rate * 0.9)) },
  ]);
  const stock = SPARES.flatMap((s, i) =>
    DEMO_WAREHOUSES.map((warehouse, w) => {
      const qty = (i * 7 + w * 3) % 12; // some items at 0: "out of stock" in the demo
      return {
        itemCode: s.code,
        warehouse,
        actualQty: new Prisma.Decimal(qty),
        projectedQty: new Prisma.Decimal(qty + (i % 3)),
      };
    }),
  );
  return { customers, items, prices, stock };
}
