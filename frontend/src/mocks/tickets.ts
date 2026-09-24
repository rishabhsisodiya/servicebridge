/**
 * TEMPORARY sample data for the session 2 screens. Replaced by the tickets API
 * in session 8. All companies and people are fictional.
 */
import type { Priority, SlaState, TicketStage } from "@/features/tickets/display";

export type Coverage = "AMC" | "Warranty" | "Chargeable";

export interface MockTicket {
  number: string;
  customer: string;
  site: string;
  machine: string;
  serial: string;
  issue: string;
  stage: TicketStage;
  priority: Priority;
  engineer?: string;
  sla: { kind: "Response" | "Resolution"; text: string; state: SlaState };
  channel: "Phone" | "WhatsApp" | "Email" | "Portal" | "AMC visit";
  coverage: Coverage;
  logged: string;
}

export const MOCK_TICKETS: MockTicket[] = [
  {
    number: "SB-26-000418",
    customer: "Ridgeway Aggregates",
    site: "Hosur",
    machine: "Jaw Crusher JX-1100",
    serial: "JX1100-2403-017",
    issue: "Toggle plate cracked, plant stopped",
    stage: "NEW",
    priority: "CRITICAL",
    sla: { kind: "Response", text: "22m left", state: "risk" },
    channel: "Phone",
    coverage: "Warranty",
    logged: "Today 09:41",
  },
  {
    number: "SB-26-000402",
    customer: "Kaveri Stoneworks",
    site: "Mandya",
    machine: "Jaw Crusher JX-1100",
    serial: "JX1100-2209-004",
    issue: "Jaw dies worn, product oversize",
    stage: "ACCEPTED",
    priority: "CRITICAL",
    engineer: "Arjun Menon",
    sla: { kind: "Resolution", text: "Breached 45m", state: "breach" },
    channel: "WhatsApp",
    coverage: "Chargeable",
    logged: "Yesterday",
  },
  {
    number: "SB-26-000415",
    customer: "Northfield Infra",
    site: "Nelamangala",
    machine: "Cone Crusher CX-400",
    serial: "CX400-2311-052",
    issue: "Heavy vibration, output size drifting",
    stage: "IN_PROGRESS",
    priority: "HIGH",
    engineer: "Farhan Qureshi",
    sla: { kind: "Resolution", text: "2h 05m left", state: "risk" },
    channel: "Phone",
    coverage: "AMC",
    logged: "Today 08:15",
  },
  {
    number: "SB-26-000397",
    customer: "Summit Road Builders",
    site: "Tumakuru",
    machine: "Hot Mix Plant 120 TPH",
    serial: "HMP120-2201-009",
    issue: "Burner fails to ignite after shutdown",
    stage: "ON_HOLD",
    priority: "HIGH",
    engineer: "Deepa Raghavan",
    sla: { kind: "Resolution", text: "Paused · awaiting spare", state: "paused" },
    channel: "Email",
    coverage: "Chargeable",
    logged: "22 Sep",
  },
  {
    number: "SB-26-000411",
    customer: "Kaveri Stoneworks",
    site: "Srirangapatna",
    machine: "Vibrating Screen VS-3D",
    serial: "VS3D-2302-118",
    issue: "Mesh torn on second deck",
    stage: "ASSIGNED",
    priority: "MEDIUM",
    engineer: "Arjun Menon",
    sla: { kind: "Response", text: "1d 2h left", state: "ok" },
    channel: "WhatsApp",
    coverage: "Warranty",
    logged: "Today 07:50",
  },
  {
    number: "SB-26-000409",
    customer: "Tri-Valley Minerals",
    site: "Chitradurga",
    machine: "VSI Sand Maker V-80",
    serial: "V80-2209-033",
    issue: "Rotor tip wear, planned replacement",
    stage: "ON_SITE",
    priority: "MEDIUM",
    engineer: "Kiran Shetty",
    sla: { kind: "Resolution", text: "6h 30m left", state: "ok" },
    channel: "AMC visit",
    coverage: "AMC",
    logged: "Today 07:10",
  },
  {
    number: "SB-26-000388",
    customer: "Ridgeway Aggregates",
    site: "Krishnagiri",
    machine: "Belt Conveyor 800 mm",
    serial: "BC800-2107-061",
    issue: "Belt drifting to one side under load",
    stage: "TRIAGED",
    priority: "LOW",
    sla: { kind: "Response", text: "2d left", state: "ok" },
    channel: "Portal",
    coverage: "AMC",
    logged: "23 Sep",
  },
  {
    number: "SB-26-000395",
    customer: "Blue Mesa Quarries",
    site: "Kolar",
    machine: "Mobile Crushing Unit MCU-250",
    serial: "MCU250-2305-006",
    issue: "Hydraulic oil leak at feeder",
    stage: "RESOLVED",
    priority: "HIGH",
    engineer: "Kiran Shetty",
    sla: { kind: "Resolution", text: "Met", state: "met" },
    channel: "Phone",
    coverage: "Warranty",
    logged: "23 Sep",
  },
  {
    number: "SB-26-000383",
    customer: "Tri-Valley Minerals",
    site: "Hiriyur",
    machine: "Cone Crusher CX-400",
    serial: "CX400-2206-021",
    issue: "Lube oil pressure alarm",
    stage: "VERIFIED",
    priority: "LOW",
    engineer: "Neha Kulkarni",
    sla: { kind: "Resolution", text: "Met", state: "met" },
    channel: "Portal",
    coverage: "AMC",
    logged: "22 Sep",
  },
  {
    number: "SB-26-000379",
    customer: "Northfield Infra",
    site: "Nelamangala",
    machine: "Vibrating Screen VS-3D",
    serial: "VS3D-2111-090",
    issue: "Bearing noise at drive end",
    stage: "CLOSED",
    priority: "MEDIUM",
    engineer: "Farhan Qureshi",
    sla: { kind: "Resolution", text: "Met", state: "met" },
    channel: "Phone",
    coverage: "Chargeable",
    logged: "21 Sep",
  },
];

export interface MockEngineer {
  name: string;
  region: string;
  skills: string;
  status: "Available" | "On visit" | "Off duty";
  open: number;
}

export const MOCK_ENGINEERS: MockEngineer[] = [
  {
    name: "Farhan Qureshi",
    region: "Bengaluru Rural",
    skills: "Cone, VSI",
    status: "On visit",
    open: 3,
  },
  { name: "Arjun Menon", region: "Mysuru", skills: "Jaw, Screens", status: "On visit", open: 4 },
  {
    name: "Kiran Shetty",
    region: "Central",
    skills: "VSI, Mobile units",
    status: "On visit",
    open: 2,
  },
  {
    name: "Deepa Raghavan",
    region: "Tumakuru",
    skills: "Hot mix, Burners",
    status: "Available",
    open: 1,
  },
  {
    name: "Neha Kulkarni",
    region: "Central",
    skills: "Cone, Lubrication",
    status: "Available",
    open: 0,
  },
  { name: "Vikas Rao", region: "Kolar", skills: "Jaw, Conveyors", status: "Off duty", open: 0 },
];

export function findMockTicket(number: string): MockTicket | undefined {
  return MOCK_TICKETS.find((t) => t.number === number);
}
