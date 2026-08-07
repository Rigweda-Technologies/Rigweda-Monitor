import { apiClient } from "../../api/client";
import type { Organization, OrganizationInput } from "./types";

const now = new Date().toISOString();
const seed: Organization[] = [
  { id:"91d2aca0-92ad-44a8-84b8-092a41642342",code:"RW-LABS",name:"Rigweda Labs",legalName:"Rigweda Labs Private Limited",registrationNumber:"U62099TG2026PTC001",taxIdentifier:"36AABCR1234A1Z5",email:"people@rigweda.example",phone:"+91 40 5555 0142",website:"https://rigweda.example",logoUrl:null,status:"active",timezone:"Asia/Kolkata",locale:"en-IN",currency:"INR",fiscalYearStartMonth:4,address:{line1:"Knowledge District",city:"Hyderabad",state:"Telangana",postalCode:"500081",country:"IN"},theme:{preset:"emerald",appearance:"light"},version:1,createdAt:now,updatedAt:now },
  { id:"26591060-7e73-485c-be5a-a75f48947306",code:"NORTH",name:"Northstar Studio",legalName:"Northstar Studio LLP",registrationNumber:null,taxIdentifier:null,email:"hello@northstar.example",phone:null,website:null,logoUrl:null,status:"active",timezone:"Asia/Kolkata",locale:"en-IN",currency:"INR",fiscalYearStartMonth:4,address:{city:"Bengaluru",state:"Karnataka",country:"IN"},theme:{preset:"indigo",appearance:"system"},version:1,createdAt:now,updatedAt:now },
  { id:"93e5e23f-b711-45a1-be3c-cefa642195ad",code:"APEX",name:"Apex Services",legalName:null,registrationNumber:null,taxIdentifier:null,email:"admin@apex.example",phone:null,website:null,logoUrl:null,status:"inactive",timezone:"Asia/Kolkata",locale:"en-IN",currency:"INR",fiscalYearStartMonth:4,address:{city:"Pune",state:"Maharashtra",country:"IN"},theme:{preset:"ocean",appearance:"light"},version:1,createdAt:now,updatedAt:now }
];
const KEY = "rigweda.demo.organizations";
const demoEnabled = import.meta.env.MODE === "test" || (import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE !== "false");
const readDemo = (): Organization[] => { const stored = localStorage.getItem(KEY); return stored ? JSON.parse(stored) : seed; };
const writeDemo = (items: Organization[]) => localStorage.setItem(KEY, JSON.stringify(items));
const delay = () => new Promise((resolve) => setTimeout(resolve, 180));

export const organizationApi = {
  async list(search = "", status = "all") {
    if (!demoEnabled) return (await apiClient.get("/organizations", { params: { search, status } })).data.data as { items: Organization[]; total: number };
    await delay();
    const query = search.toLowerCase();
    const items = readDemo().filter((item) => (!query || item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query)) && (status === "all" || item.status === status));
    return { items, total: items.length };
  },
  async create(input: OrganizationInput) {
    if (!demoEnabled) return (await apiClient.post("/organizations", input)).data.data as Organization;
    await delay(); const items = readDemo();
    if (items.some((item) => item.code === input.code)) throw new Error("An organization with this code already exists.");
    const item: Organization = { ...input, id: crypto.randomUUID(), version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    writeDemo([...items, item]); return item;
  },
  async update(id: string, patch: Partial<Organization> & { version: number }) {
    if (!demoEnabled) return (await apiClient.patch(`/organizations/${id}`, patch)).data.data as Organization;
    await delay(); const items = readDemo(); const current = items.find((item) => item.id === id);
    if (!current) throw new Error("Organization not found.");
    const updated = { ...current, ...patch, version: current.version + 1, updatedAt: new Date().toISOString() };
    writeDemo(items.map((item) => item.id === id ? updated : item)); return updated;
  }
};
