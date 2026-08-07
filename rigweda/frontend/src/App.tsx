import { lazy, Suspense, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ThemePanel } from "./components/ThemePanel";
import { Dashboard } from "./pages/Dashboard";

const OrganizationsPage=lazy(()=>import("./pages/OrganizationsPage").then(module=>({default:module.OrganizationsPage})));
const ModulePlaceholder=lazy(()=>import("./pages/ModulePlaceholder").then(module=>({default:module.ModulePlaceholder})));
const PeoplePage=lazy(()=>import("./pages/PeoplePage").then(module=>({default:module.PeoplePage})));
const SettingsPage=lazy(()=>import("./pages/SettingsPage").then(module=>({default:module.SettingsPage})));
const EmployeesPage=lazy(()=>import("./pages/EmployeesPage").then(module=>({default:module.EmployeesPage})));
const MyProfilePage=lazy(()=>import("./pages/MyProfilePage").then(module=>({default:module.MyProfilePage})));
const StructurePage=lazy(()=>import("./pages/StructurePage").then(module=>({default:module.StructurePage})));
const AttendancePage=lazy(()=>import("./pages/AttendancePage").then(module=>({default:module.AttendancePage})));
const LeavePage=lazy(()=>import("./pages/LeavePage").then(module=>({default:module.LeavePage})));
const WorkLogsPage=lazy(()=>import("./pages/WorkLogsPage").then(module=>({default:module.WorkLogsPage})));
const PayrollPage=lazy(()=>import("./pages/PayrollPage").then(module=>({default:module.PayrollPage})));
const RecruitmentPage=lazy(()=>import("./pages/RecruitmentPage").then(module=>({default:module.RecruitmentPage})));

export default function App({onSignOut}:{onSignOut?:()=>void|Promise<void>}) {
  const [themeOpen, setThemeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState("Overview");
  const common={onTheme:()=>setThemeOpen(true),onMenu:()=>setMenuOpen(true)};
  const page = active === "Overview" ? <Dashboard {...common} /> : active === "Organizations" ? <OrganizationsPage {...common} /> : active === "Access" ? <PeoplePage {...common}/> : active === "Employees" ? <EmployeesPage {...common}/> : active === "My Profile" ? <MyProfilePage {...common}/> : active === "Structure" ? <StructurePage {...common}/> : active === "Attendance" ? <AttendancePage {...common}/> : active === "Time off" ? <LeavePage {...common}/> : active === "Work logs" ? <WorkLogsPage {...common}/> : active === "Payroll" ? <PayrollPage {...common}/> : active === "Recruitment" ? <RecruitmentPage {...common}/> : active === "Settings" ? <SettingsPage {...common}/> : <ModulePlaceholder name={active} onBack={() => setActive("Overview")} {...common} />;
  return <div className="app-shell"><Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} active={active} onSelect={setActive} onSignOut={onSignOut} /><Suspense fallback={<main className="main-content"><p className="directory-message">Loading module…</p></main>}>{page}</Suspense><ThemePanel open={themeOpen} onClose={() => setThemeOpen(false)} /></div>;
}
