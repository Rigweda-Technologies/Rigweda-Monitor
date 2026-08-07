import { ArrowUpRight, Bell, CalendarCheck, CheckCircle, Clock, List, Palette, Sparkle, UserCheck, Users } from "@phosphor-icons/react";
import { useAuth } from "../features/auth/AuthProvider";

const stats = [
  { label: "People", value: "128", change: "+6 this month", Icon: Users, tone: "purple" },
  { label: "Present today", value: "114", change: "89% attendance", Icon: UserCheck, tone: "green" },
  { label: "On leave", value: "8", change: "3 planned", Icon: CalendarCheck, tone: "orange" },
  { label: "Needs attention", value: "6", change: "2 urgent", Icon: Bell, tone: "red" }
];

export function Dashboard({ onTheme, onMenu }: { onTheme: () => void; onMenu: () => void }) {
  const { hasPermission } = useAuth();
  return (
    <main className="main-content">
      <header className="topbar">
        <button className="mobile-menu icon-button" onClick={onMenu}><List /><span className="sr-only">Open navigation</span></button>
        <div className="topbar-copy"><span>Friday, 7 August</span><strong>Good morning, Mahesh</strong></div>
        <div className="topbar-actions"><button className="theme-trigger" onClick={onTheme}><Palette size={17} />Theme</button><button className="notification-button"><Bell size={19} /><i /><span className="sr-only">Notifications</span></button><div className="avatar">MK</div></div>
      </header>
      <div className="content-wrap">
        <section className="welcome-card">
          <div><span className="eyebrow"><Sparkle size={14} />Your people workspace</span><h1>Everyone, moving together.</h1><p>Here’s the pulse of your organization today. Six items could use your attention.</p><button>Review priorities <ArrowUpRight size={16} /></button></div>
          <div className="orbital-art" aria-hidden="true"><i /><i /><i /><span>89<small>%</small></span></div>
        </section>
        <section className="stats-grid" aria-label="Organization summary">
          {stats.map(({ label, value, change, Icon, tone }) => <article className="stat-card" key={label}><div className={`stat-icon ${tone}`}><Icon size={20} /></div><span>{label}</span><strong>{value}</strong><small>{change}</small></article>)}
        </section>
        <section className="dashboard-grid">
          <article className="card focus-card"><header><div><span className="section-label">TODAY'S FOCUS</span><h2>Approvals waiting for you</h2></div>{hasPermission("leave.approve")&&<button>View all</button>}</header><div className="focus-list">
            <div><span className="person lavender">AN</span><p><strong>Anita Nair</strong><small>Leave request · 2 days</small></p><time>10:24</time></div>
            <div><span className="person peach">RK</span><p><strong>Rohan Kumar</strong><small>Attendance correction</small></p><time>09:45</time></div>
            <div><span className="person blue">SP</span><p><strong>Samira Patel</strong><small>Expense claim · ₹4,850</small></p><time>Yesterday</time></div>
          </div></article>
          <article className="card rhythm-card"><header><div><span className="section-label">WEEKLY RHYTHM</span><h2>Attendance trend</h2></div><span className="positive">+3.4%</span></header><div className="bars" aria-label="Monday to Friday attendance chart">{[72, 88, 80, 94, 86].map((height, index) => <div key={index}><i style={{ height: `${height}%` }} /><small>{["M", "T", "W", "T", "F"][index]}</small></div>)}</div><p><CheckCircle size={16} />Attendance is healthier than last week.</p></article>
          <article className="card moments-card"><header><div><span className="section-label">UPCOMING</span><h2>Moments that matter</h2></div>{hasPermission("attendance.read")&&<button>Calendar</button>}</header><div className="moment"><span><strong>09</strong>AUG</span><p><strong>Company foundation day</strong><small>Organization holiday</small></p></div><div className="moment"><span><strong>12</strong>AUG</span><p><strong>Payroll input deadline</strong><small>4 days remaining</small></p></div></article>
          <article className="card activity-card"><header><div><span className="section-label">RECENT ACTIVITY</span><h2>What’s happening</h2></div></header><div><i className="activity-icon"><Clock size={16} /></i><p><strong>Timesheet submitted</strong><small>Devika Rao · 12 minutes ago</small></p></div><div><i className="activity-icon"><UserCheck size={16} /></i><p><strong>New employee joined</strong><small>Arjun Mehta · Product Design</small></p></div></article>
        </section>
      </div>
    </main>
  );
}
