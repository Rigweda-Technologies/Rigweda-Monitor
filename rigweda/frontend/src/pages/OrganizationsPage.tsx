import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Buildings, CaretRight, Check, GlobeHemisphereWest, List, MagnifyingGlass, Palette, Plus, Sliders, X } from "@phosphor-icons/react";
import { organizationApi } from "../features/organizations/organization.api";
import type { Organization, OrganizationInput } from "../features/organizations/types";
import { themes, type Appearance, type ThemeId } from "../theme/themes";
import { readableOnWhite } from "../theme/color";

const emptyOrganization: OrganizationInput = {
  code:"",name:"",legalName:null,registrationNumber:null,taxIdentifier:null,email:null,phone:null,website:null,logoUrl:null,
  status:"active",timezone:"Asia/Kolkata",locale:"en-IN",currency:"INR",fiscalYearStartMonth:4,address:{country:"IN"},
  theme:{preset:"emerald",appearance:"light"}
};
const fiscalMonths = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const tone = (name: string) => ["mint","lilac","sky","sand"][name.charCodeAt(0) % 4];

function PageHeader({ onTheme, onMenu }: { onTheme: () => void; onMenu: () => void }) {
  return <header className="topbar"><button className="mobile-menu icon-button" onClick={onMenu}><List /><span className="sr-only">Open navigation</span></button><div className="topbar-copy"><span>Workspace administration</span><strong>Organizations</strong></div><div className="topbar-actions"><button className="theme-trigger" onClick={onTheme}><Palette size={17} />Theme</button><div className="avatar">MK</div></div></header>;
}

function OrganizationEditor({ organization, onClose }: { organization: Organization | null | undefined; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"profile"|"appearance">("profile");
  const [form, setForm] = useState<OrganizationInput>(() => organization ? { ...organization } : emptyOrganization);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => organization ? organizationApi.update(organization.id, { ...form, version: organization.version }) : organizationApi.create(form),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey:["organizations"] }); onClose(); },
    onError: (reason) => setError(reason instanceof Error ? reason.message : "Unable to save the organization.")
  });
  const field = (key: keyof OrganizationInput, value: unknown) => setForm((current) => ({ ...current, [key]: value }));
  const address = (key: string, value: string) => setForm((current) => ({ ...current, address: { ...current.address, [key]: value } }));
  const theme = (key: string, value: string) => setForm((current) => ({ ...current, theme: { ...current.theme, [key]: value } }));
  const validCustom = form.theme.preset !== "custom" || readableOnWhite(form.theme.customPrimary || "#315b4f");
  const submit = (event: FormEvent) => { event.preventDefault(); setError(""); if (validCustom) save.mutate(); };

  return <div className="editor-layer"><form className="organization-editor" onSubmit={submit}>
    <header><div><span className="editor-kicker">ORGANIZATION</span><h2>{organization ? "Edit organization" : "Create organization"}</h2><p>{organization ? `${organization.code} · Version ${organization.version}` : "Set up an independent workspace."}</p></div><button type="button" className="icon-button" onClick={onClose}><X/><span className="sr-only">Close</span></button></header>
    <div className="editor-tabs"><button type="button" className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><Buildings size={15}/>Profile</button><button type="button" className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}><Sliders size={15}/>Appearance</button></div>
    <div className="editor-body">
      {tab === "profile" ? <>
        <div className="form-section-title"><h3>Identity</h3><p>The organization’s public and legal identity.</p></div>
        <div className="form-grid"><label>Display name <input required minLength={2} value={form.name} onChange={(e)=>field("name",e.target.value)} placeholder="Rigweda Labs" /></label><label>Organization code <input required disabled={!!organization} value={form.code} onChange={(e)=>field("code",e.target.value.toUpperCase())} placeholder="RW-LABS" /></label><label className="full-field">Legal name <input value={form.legalName||""} onChange={(e)=>field("legalName",e.target.value)} placeholder="Registered legal entity name" /></label><label>Registration number <input value={form.registrationNumber||""} onChange={(e)=>field("registrationNumber",e.target.value)} /></label><label>Tax identifier <input value={form.taxIdentifier||""} onChange={(e)=>field("taxIdentifier",e.target.value)} /></label></div>
        <div className="form-section-title"><h3>Contact</h3><p>Primary business contact information.</p></div>
        <div className="form-grid"><label>Email <input type="email" value={form.email||""} onChange={(e)=>field("email",e.target.value)} placeholder="people@company.com" /></label><label>Phone <input value={form.phone||""} onChange={(e)=>field("phone",e.target.value)} placeholder="+91 40 0000 0000" /></label><label className="full-field">Website <input type="url" value={form.website||""} onChange={(e)=>field("website",e.target.value)} placeholder="https://company.com" /></label><label className="full-field">Logo URL <input type="url" value={form.logoUrl||""} onChange={(e)=>field("logoUrl",e.target.value)} placeholder="https://cdn.company.com/brand/logo.svg" /></label></div>
        <div className="form-section-title"><h3>Registered address</h3></div>
        <div className="form-grid"><label className="full-field">Address line <input value={form.address.line1||""} onChange={(e)=>address("line1",e.target.value)} /></label><label>City <input value={form.address.city||""} onChange={(e)=>address("city",e.target.value)} /></label><label>State <input value={form.address.state||""} onChange={(e)=>address("state",e.target.value)} /></label><label>Postal code <input value={form.address.postalCode||""} onChange={(e)=>address("postalCode",e.target.value)} /></label><label>Country code <input maxLength={2} value={form.address.country||"IN"} onChange={(e)=>address("country",e.target.value.toUpperCase())} /></label></div>
        <div className="form-section-title"><h3>Regional defaults</h3></div>
        <div className="form-grid"><label>Timezone <select value={form.timezone} onChange={(e)=>field("timezone",e.target.value)}><option>Asia/Kolkata</option><option>Asia/Dubai</option><option>Europe/London</option><option>America/New_York</option></select></label><label>Currency <select value={form.currency} onChange={(e)=>field("currency",e.target.value)}><option>INR</option><option>USD</option><option>GBP</option><option>AED</option></select></label><label>Financial year begins <select value={form.fiscalYearStartMonth} onChange={(e)=>field("fiscalYearStartMonth",Number(e.target.value))}>{fiscalMonths.map((month,index)=><option value={index+1} key={month}>{month}</option>)}</select></label><label>Status <select value={form.status} onChange={(e)=>field("status",e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
      </> : <>
        <div className="appearance-intro"><span><Palette/></span><div><h3>Organization theme</h3><p>This becomes the default palette for everyone in this organization. Personal overrides will be added with user accounts.</p></div></div>
        <label className="field-label">Default appearance</label><div className="appearance-choices">{(["light","dark","system"] as Appearance[]).map((value)=><button type="button" className={form.theme.appearance===value?"selected":""} onClick={()=>theme("appearance",value)} key={value}>{form.theme.appearance===value&&<Check size={14}/>} {value}</button>)}</div>
        <label className="field-label">Color palette</label><div className="organization-theme-grid">{Object.entries(themes).map(([id,option])=><button type="button" key={id} className={form.theme.preset===id?"selected":""} onClick={()=>theme("preset",id)}><span>{option.colors.map(color=><i key={color} style={{background:color}}/>)}</span><strong>{option.label}</strong><small>{option.description}</small>{form.theme.preset===id&&<Check className="selected-check" size={16}/>}</button>)}<button type="button" className={form.theme.preset==="custom"?"selected":""} onClick={()=>theme("preset","custom")}><span><i style={{background:form.theme.customPrimary||"#315b4f"}}/><i style={{background:form.theme.customAccent||"#d08b3e"}}/></span><strong>Custom</strong><small>Your own combination</small>{form.theme.preset==="custom"&&<Check className="selected-check" size={16}/>}</button></div>
        {form.theme.preset==="custom"&&<div className="organization-custom-colors"><label>Primary <span><input type="color" value={form.theme.customPrimary||"#315b4f"} onChange={(e)=>theme("customPrimary",e.target.value)}/><code>{form.theme.customPrimary||"#315b4f"}</code></span></label><label>Accent <span><input type="color" value={form.theme.customAccent||"#d08b3e"} onChange={(e)=>theme("customAccent",e.target.value)}/><code>{form.theme.customAccent||"#d08b3e"}</code></span></label>{!validCustom&&<p>Primary color needs more contrast against white text.</p>}</div>}
      </>}
    </div>
    <footer>{error&&<p className="form-error">{error}</p>}<button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={save.isPending||!validCustom}>{save.isPending?"Saving…":organization?"Save changes":"Create organization"}</button></footer>
  </form></div>;
}

export function OrganizationsPage({ onTheme, onMenu }: { onTheme:()=>void; onMenu:()=>void }) {
  const [search,setSearch]=useState(""); const [status,setStatus]=useState("all"); const [editing,setEditing]=useState<Organization|null|undefined>(undefined);
  const query=useQuery({queryKey:["organizations",search,status],queryFn:()=>organizationApi.list(search,status),placeholderData:(previous)=>previous});
  const counts=useMemo(()=>({all:query.data?.items.length||0,active:query.data?.items.filter(item=>item.status==="active").length||0}),[query.data]);
  return <main className="main-content"><PageHeader onTheme={onTheme} onMenu={onMenu}/><div className="organizations-wrap">
    <section className="page-heading"><div><span className="eyebrow dark"><Buildings size={14}/>WORKSPACE DIRECTORY</span><h1>Your organizations</h1><p>Create and configure each independent people workspace.</p></div><button className="primary-button" onClick={()=>setEditing(null)}><Plus size={16}/>New organization</button></section>
    <section className="organization-summary"><article><span>Total workspaces</span><strong>{counts.all}</strong><small>Across your account</small></article><article><span>Active</span><strong>{counts.active}</strong><small>Ready for people</small></article><article><span>Regions</span><strong>{new Set(query.data?.items.map(item=>item.timezone)).size||0}</strong><small>Operating timezones</small></article></section>
    <section className="organization-directory"><header><div className="search-box"><MagnifyingGlass size={16}/><input aria-label="Search organizations" value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search by name or code"/></div><select aria-label="Filter by status" value={status} onChange={(e)=>setStatus(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></header>
      {query.isLoading?<div className="directory-state">Loading organizations…</div>:query.isError?<div className="directory-state error">Couldn’t load organizations. Check the API connection.</div>:query.data?.items.length===0?<div className="directory-state"><Buildings/><strong>No organizations found</strong><span>Try another search or create a workspace.</span></div>:<div className="organization-list">{query.data?.items.map(item=><button key={item.id} onClick={()=>setEditing(item)}><span className={`organization-avatar ${tone(item.name)}`}>{item.name.slice(0,2).toUpperCase()}</span><span className="organization-name"><strong>{item.name}</strong><small>{item.legalName||"Legal name not added"}</small></span><span className="organization-location"><GlobeHemisphereWest size={14}/>{item.address.city||"Location pending"}<small>{item.timezone}</small></span><span className={`status-pill ${item.status}`}>{item.status}</span><span className="organization-code">{item.code}</span><CaretRight className="row-arrow" size={18}/></button>)}</div>}
    </section>
  </div>{editing!==undefined&&<OrganizationEditor organization={editing} onClose={()=>setEditing(undefined)}/>}</main>;
}
