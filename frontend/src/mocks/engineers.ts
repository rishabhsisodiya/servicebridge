/**
 * TEMPORARY sample data for the home page engineers card. Replaced by engineer
 * availability in session 9. All people are fictional.
 */

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
