import { Buildings, CalendarBlank, Clock, CurrencyCircleDollar, GearSix, IdentificationCard, Pulse, SignOut, SquaresFour, TreeStructure, User, UserCircle, UsersThree } from "@phosphor-icons/react";
import { useAuth } from "../features/auth/AuthProvider";
import { BrandMark } from "./BrandMark";

const items = [
  [SquaresFour, "Overview"], [IdentificationCard, "Employees"], [UserCircle, "My Profile"], [TreeStructure, "Structure"], [UsersThree, "Access"], [Clock, "Attendance"],
  [CalendarBlank, "Time off"], [Pulse, "Work logs"], [CurrencyCircleDollar, "Payroll"],
  [User, "Recruitment"], [Buildings, "Organizations"], [GearSix, "Settings"]
] as const;

export function Sidebar({ open, onClose, active, onSelect, onSignOut }: { open: boolean; onClose: () => void; active: string; onSelect: (item: string) => void; onSignOut?:()=>void|Promise<void> }) {
  const { user } = useAuth();
  const itemsToShow = items.filter(([_, label]) => label !== "Organizations" || user?.roleKey === "system_admin");
  return (
    <>
      {open && <button className="sidebar-scrim" onClick={onClose} aria-label="Close navigation" />}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand"><BrandMark /><div><strong>Rigweda</strong><small>People, in rhythm</small></div></div>
        <nav aria-label="Main navigation">
          {itemsToShow.map(([Icon, label]) => (
            <button className={active === label ? "nav-active" : ""} onClick={() => { onSelect(label); onClose(); }} key={label}><Icon size={18} weight="duotone" /><span>{label}</span></button>
          ))}
        </nav>
        <div className="sidebar-foot"><span><i className="status-dot" />All systems ready</span>{onSignOut&&<button onClick={onSignOut} title="Sign out"><SignOut size={16}/><span className="sr-only">Sign out</span></button>}</div>
      </aside>
    </>
  );
}
