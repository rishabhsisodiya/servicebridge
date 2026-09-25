import type { BillingUnit, Coverage, TicketPriority, TicketStage } from '@prisma/client';
import type { OpeningWindow } from './business-calendar';

/** Out-of-the-box service rules. Created once when a table is empty; admins change them after. */

export const PRIORITIES: { priority: TicketPriority; label: string; description: string }[] = [
  { priority: 'CRITICAL', label: 'Critical', description: 'Machine stopped; production is lost.' },
  {
    priority: 'HIGH',
    label: 'High',
    description: 'Running with reduced output, or a safety risk.',
  },
  { priority: 'MEDIUM', label: 'Medium', description: 'A fault that can wait for a planned slot.' },
  { priority: 'LOW', label: 'Low', description: 'Advice, documents or minor issues.' },
];

export const STAGES: { stage: TicketStage; label: string; description: string }[] = [
  { stage: 'NEW', label: 'New', description: 'Logged, not yet reviewed.' },
  {
    stage: 'TRIAGED',
    label: 'With area manager',
    description: 'Reviewed; waiting for an engineer.',
  },
  { stage: 'ASSIGNED', label: 'Engineer assigned', description: 'An engineer has been chosen.' },
  { stage: 'ACCEPTED', label: 'Accepted', description: 'The engineer has accepted the job.' },
  { stage: 'ON_SITE', label: 'On site', description: 'The engineer has reached the site.' },
  { stage: 'IN_PROGRESS', label: 'In progress', description: 'Work has started.' },
  {
    stage: 'ON_HOLD',
    label: 'On hold',
    description: 'Paused, e.g. waiting for spares. The SLA clock stops.',
  },
  { stage: 'RESOLVED', label: 'Resolved', description: 'The engineer has fixed the fault.' },
  { stage: 'VERIFIED', label: 'Verified', description: 'The fix is confirmed.' },
  { stage: 'CLOSED', label: 'Closed', description: 'Finished; feedback requested.' },
  { stage: 'CANCELLED', label: 'Cancelled', description: 'Not needed any more.' },
];

export const CALENDAR_24X7 = '24×7';
export const CALENDAR_BUSINESS = 'Business hours';

export const BUSINESS_HOURS: OpeningWindow[] = [1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  open: '09:00',
  close: '18:00',
}));

const h = (hours: number) => hours * 60;

/** [coverage, priority, response, resolution, calendar] */
export const SLA_DEFAULTS: [Coverage, TicketPriority, number, number, string][] = [
  ['AMC', 'CRITICAL', h(2), h(24), CALENDAR_24X7],
  ['AMC', 'HIGH', h(4), h(48), CALENDAR_BUSINESS],
  ['AMC', 'MEDIUM', h(8), h(72), CALENDAR_BUSINESS],
  ['AMC', 'LOW', h(24), h(120), CALENDAR_BUSINESS],
  ['WARRANTY', 'CRITICAL', h(4), h(48), CALENDAR_BUSINESS],
  ['WARRANTY', 'HIGH', h(8), h(72), CALENDAR_BUSINESS],
  ['WARRANTY', 'MEDIUM', h(16), h(96), CALENDAR_BUSINESS],
  ['WARRANTY', 'LOW', h(24), h(144), CALENDAR_BUSINESS],
  ['CHARGEABLE', 'CRITICAL', h(8), h(72), CALENDAR_BUSINESS],
  ['CHARGEABLE', 'HIGH', h(16), h(96), CALENDAR_BUSINESS],
  ['CHARGEABLE', 'MEDIUM', h(24), h(144), CALENDAR_BUSINESS],
  ['CHARGEABLE', 'LOW', h(48), h(168), CALENDAR_BUSINESS],
];

export const SERVICE_TYPES: {
  name: string;
  description: string;
  defaultPriority: TicketPriority;
  requiresEquipment: boolean;
}[] = [
  {
    name: 'Breakdown',
    description: 'The machine has stopped or is faulty.',
    defaultPriority: 'HIGH',
    requiresEquipment: true,
  },
  {
    name: 'Preventive maintenance',
    description: 'A planned service visit.',
    defaultPriority: 'LOW',
    requiresEquipment: true,
  },
  {
    name: 'Installation & commissioning',
    description: 'Setting up a new machine.',
    defaultPriority: 'MEDIUM',
    requiresEquipment: true,
  },
  {
    name: 'Inspection',
    description: 'A health check or audit of the machine.',
    defaultPriority: 'LOW',
    requiresEquipment: true,
  },
  {
    name: 'Operator training',
    description: "Training the customer's operators.",
    defaultPriority: 'LOW',
    requiresEquipment: false,
  },
];

export const BILLING_RATES: { code: string; name: string; unit: BillingUnit; amount: number }[] = [
  { code: 'VISIT', name: 'Visit charge', unit: 'PER_VISIT', amount: 2500 },
  { code: 'LABOUR', name: 'Labour', unit: 'PER_HOUR', amount: 850 },
  { code: 'TRAVEL', name: 'Travel', unit: 'PER_KM', amount: 14 },
];
