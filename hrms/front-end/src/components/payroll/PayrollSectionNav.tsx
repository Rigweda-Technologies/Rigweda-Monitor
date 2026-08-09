import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { FileArchive, ListChecks, ReceiptText, Settings2, UsersRound } from "lucide-react";

const items = [
  { label: "Setup", to: "/payroll/setup", icon: Settings2 },
  { label: "Documents", to: "/organization/documents", icon: FileArchive },
  { label: "Employees", to: "/payroll/employees", icon: UsersRound },
  { label: "Runs", to: "/payroll/runs", icon: ListChecks },
  { label: "Breakdown", to: "/payroll/employee-breakdown", icon: ReceiptText }
];

export const PayrollSectionNav = () => {
  const location = useLocation();

  return (
    <div className="mb-6 rounded-lg border bg-card p-2 shadow-sm">
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
        {items.map((item) => {
          const active = location.pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors md:justify-start md:px-4",
                active
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default PayrollSectionNav;
