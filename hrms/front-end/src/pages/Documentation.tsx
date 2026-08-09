import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/useAuth";

type DocSection = {
  id: string;
  category: string;
  title: string;
  description?: string;
  points?: string[];
  checklist?: string[];
  warnings?: string[];
};

const administratorSections: DocSection[] = [
  {
    id: "administrator-overview",
    category: "Getting Started",
    title: "Platform Overview",
    points: [
      "Configure organizational master data before daily operations begin.",
      "Use role and permission management to control data access and actions.",
      "Use approval workflows for leave and attendance correction requests."
    ]
  },
  {
    id: "administrator-setup",
    category: "Getting Started",
    title: "Mandatory Setup Sequence",
    checklist: [
      "Create roles and assign the required permissions",
      "Create departments and designations",
      "Create shifts and assign employees to the correct shift",
      "Configure weekly off policies (default and shift-specific)",
      "Create the holiday calendar",
      "Create leave types",
      "Configure organization settings (sandwich rule, attendance lock)",
      "Define approval workflows"
    ]
  },
  {
    id: "administrator-payroll-quick-start",
    category: "Payroll",
    title: "Payroll Setup Guide For Clients",
    description:
      "Use this sequence when payroll is being configured for the first time. Complete the steps in order so the salary package shown on each employee matches the selected pay group and components.",
    points: [
      "Start in Payroll > Setup. A Pay Group is the salary cycle for a set of employees. Example: Monthly Staff, Consultants, Weekly Workers, or Factory Staff.",
      "Click Add Pay Group and enter a clear code and name. Use short codes such as MONTHLY, WEEKLY, or CONTRACT. Select salary frequency, salary pay day, work week days, and default Basic percentage.",
      "After creating the pay group, open Setup Wizard for that pay group. The wizard loads the salary components that will be used for employees in that pay group.",
      "In the Salary Components step, review earnings, deductions, and employer contributions. Earnings increase salary, deductions reduce take-home salary, and employer contributions are company-paid costs.",
      "Keep the default Telangana components if they match your company policy. Edit the component name, calculation type, percentage, amount, or formula only when the company salary policy requires it.",
      "Save the wizard. This connects the selected components to the pay group, so employees assigned to that pay group can receive salary packages from those components.",
      "Open Employees, edit an employee, and go to the Salary tab. Select the correct Pay Group, enter Annual CTC, and review the auto-calculated Monthly Gross, Basic Pay, Variable Pay, HRA, PF, ESI, and other component values.",
      "Use employee-level component enable or disable only for approved exceptions. Example: disable a bonus component for one employee, enable a special allowance, or change an employee-specific percentage.",
      "Save salary details, bank details, and statutory details for the employee. The Payroll Employees page will then show the employee under the selected pay group.",
      "After employee salary setup is complete, generate attendance snapshots, create payroll run, validate, submit for approval, approve, lock, and generate payslips.",
      "Attendance snapshot is the bridge between Attendance and Payroll. The snapshot freezes the payroll month into payable days, LOP days, holidays, week offs, paid or unpaid leave, and overtime before payroll is computed.",
      "Preferred monthly flow: finalize attendance, approve leave, lock the attendance month, confirm the snapshot is generated, then create and compute payroll for that month.",
      "If attendance corrections or leave changes happen after snapshot generation, regenerate the attendance snapshot for that month and recompute the payroll run so payroll uses the latest attendance totals."
    ],
    checklist: [
      "Payroll is enabled in Organization Settings",
      "At least one pay group is created in Payroll > Setup",
      "Setup Wizard is saved for the pay group with all required salary components",
      "Each payroll employee has a pay group selected in the employee Salary tab",
      "Annual CTC is entered for each payroll employee",
      "Employee-specific component overrides are reviewed and used only where needed",
      "Bank details are saved for all payroll employees",
      "PAN, UAN, ESI, PF, and tax details are complete where applicable",
      "Attendance and leave approvals are finalized for the payroll month",
      "Payroll validation errors are resolved before final approval and lock"
    ],
    warnings: [
      "Do not lock a payroll run until salary setup, attendance, leave approvals, bank details, and statutory details have all been checked. Locked payroll should be treated as final."
    ]
  },
  {
    id: "administrator-payroll-components",
    category: "Payroll",
    title: "Understanding Pay Groups And Components",
    points: [
      "Pay Group: A payroll cycle and rule set. Employees in the same pay group share the same payroll frequency, pay day, attendance cutoff, and default salary component setup.",
      "Annual CTC: The yearly company cost for the employee. When entered in the Salary tab, the system uses the selected pay group rules to calculate salary values.",
      "Monthly Gross: The monthly earnings before employee deductions. This is calculated from CTC and company contribution rules.",
      "Basic Pay: The base salary amount. It usually drives HRA, PF, gratuity, and other formula-based components.",
      "Earnings: Components paid to the employee, such as Basic, HRA, Other Allowance, Bonus, and Variable Pay.",
      "Deductions: Components deducted from salary, such as PF, ESI, PT, TDS, loans, or recoveries.",
      "Employer Contributions: Company-paid amounts such as Employer PF. These are part of company cost but not deducted from employee take-home pay.",
      "Fixed Amount: Use when the component value is the same every month.",
      "Percentage: Use when the component is a percentage of another value, such as HRA as a percentage of Basic.",
      "Formula: Use when a component depends on one or more salary variables, such as PF based on Basic with a wage ceiling.",
      "Slab: Use when the amount depends on salary ranges, such as Professional Tax slabs."
    ],
    warnings: [
      "Component formulas directly affect salary output. Confirm company policy and statutory rules before changing formulas for a live pay group."
    ]
  },
  {
    id: "administrator-payroll-employee-setup",
    category: "Payroll",
    title: "Employee Salary Setup",
    points: [
      "Open Employees and choose the employee whose payroll needs to be configured.",
      "Go to the Salary tab. This tab is where the pay group is assigned to the employee.",
      "Select the Pay Group. The selected pay group decides which salary components are available for that employee.",
      "Enter Annual CTC. With auto-calculate enabled, the system calculates monthly salary values based on the pay group Basic percentage and salary rules.",
      "Review the salary preview before saving. Check Annual CTC, Monthly Gross, Basic Pay, HRA, Variable Pay, employer contribution, deductions, and estimated net salary.",
      "Use Pay Group default for normal employees. Use Employee override only when HR or Admin has approved a different component rule for that employee.",
      "Enable or disable custom components in the employee component section. Disabled components will not be considered for that employee salary package.",
      "Save salary details. Then save Bank Details and Statutory Details from the same employee payroll area.",
      "Open Payroll > Employees and select the pay group to confirm the employee appears in the assigned employee list."
    ],
    checklist: [
      "Correct pay group selected",
      "Annual CTC entered",
      "Basic percentage source reviewed: Pay Group default or Employee override",
      "Custom components enabled or disabled correctly",
      "Bank account and IFSC saved",
      "PAN, UAN, ESI, PF, and tax regime saved where applicable"
    ]
  },
  {
    id: "administrator-payroll-attendance-snapshot",
    category: "Payroll",
    title: "How Attendance Moves Into Payroll",
    description:
      "Use this section to explain to clients how attendance becomes payroll days before salary is calculated.",
    points: [
      "Payroll does not directly calculate salary from raw daily punches. First, the system creates a monthly attendance snapshot for the selected payroll month.",
      "The attendance snapshot reads attendance punches, approved leave, holidays, week offs, and minimum full-day or half-day work hours to decide each day's payroll status.",
      "For each employee, the snapshot stores totals such as calendar days, working days, present days, paid leave days, unpaid leave days, holiday days, week off days, payable days, LOP days, and overtime minutes.",
      "Payable Days means the days eligible for salary in that month. LOP Days means Loss Of Pay days that reduce salary for the month.",
      "In a normal case, Present, Paid Leave, Holiday, and Week Off add to payable days. Unpaid Leave and Absence increase LOP. Half day usually counts as half payable and half LOP.",
      "After the snapshot is ready, Payroll uses those totals to calculate proration. Example: if payable days are 27 out of 30, attendance-based earning components are paid at 90% for that month.",
      "Overtime, if captured in attendance, is also carried into payroll through the snapshot and can be added as a separate earning during payroll computation."
    ],
    checklist: [
      "Attendance is finalized for the payroll month",
      "Leave approvals are completed before snapshot generation",
      "Attendance month is locked or manually refreshed before payroll compute",
      "Attendance snapshot exists for the same payroll month being processed",
      "Payroll is recomputed after any attendance or leave correction"
    ],
    warnings: [
      "If attendance or leave is changed after snapshot generation, payroll will still use the old snapshot until it is regenerated.",
      "Do not approve or lock final payroll until attendance snapshot, leave approvals, and payable days have been verified."
    ]
  },
  {
    id: "administrator-payroll-formulas",
    category: "Payroll",
    title: "Payroll Formula Guide (Simple)",
    points: [
      "Basic Salary: usually fixed as a percentage of CTC or gross (company policy).",
      "HRA: usually calculated as a percentage of Basic for non-metro rules.",
      "Gross Salary: sum of all earnings.",
      "Net Salary: Gross minus all deductions.",
      "Use Fixed Amount for stable components, Percentage for ratio-based components, Formula for linked components, and if() for slab or threshold rules."
    ],
    warnings: [
      "Statutory thresholds and rates can change. Verify policy values before locking payroll."
    ]
  },
  {
    id: "administrator-attendance",
    category: "Daily Operations",
    title: "Attendance Administration",
    points: [
      "The attendance matrix displays present, absent, leave, holiday, and weekly off statuses.",
      "When approved half-day leave and attendance exist on the same date, matrix shows a combined Present + Leave state (PL).",
      "Pending checkout remains visible as an attendance exception, but approved half-day leave can reconcile payroll exclusion for that date.",
      "An administrator can override attendance records when correction is required.",
      "Attendance requests can be approved or rejected by reporting manager, Human Resources, or administrator roles."
    ]
  },
  {
    id: "administrator-leaves",
    category: "Daily Operations",
    title: "Leave Administration",
    points: [
      "Leave calculation excludes holidays and weekly off days unless sandwich rule conditions apply.",
      "Leave requests support Full Day and Half Day durations.",
      "Half-day leave requires a single date and session selection (First Half or Second Half).",
      "Half-day leave is not allowed on holidays or weekly off days.",
      "Pending leave can reserve leave balance based on your organization policy.",
      "Only reporting manager, Human Resources, or administrator roles can take approval actions on leave requests.",
      "Leave Management includes a month filter and a status filter; the page defaults to the current month and the table updates from both filters together.",
      "Clicking the summary cards at the top of Leave Management applies the matching status filter to the selected month.",
      "The Action By column shows the employee who approved or rejected the request, and hovering the name shows the approver or rejector designation when available."
    ]
  },
  {
    id: "administrator-dashboard",
    category: "Monitoring And Reporting",
    title: "Dashboard Views And Graphs",
    points: [
      "The dashboard supports both Data Representation and Graphical Representation modes, and the selected mode is remembered for the next visit.",
      "Graphical cards are clickable and open deeper weekly and monthly trend views where supported.",
      "Workforce Distribution shows today's visible workforce mix using present, absent, on leave, and missed checkout values.",
      "Department Workforce Mix shows present, absent, and leave split by department with labels adapted for tighter widths and browser zoom.",
      "Dashboard graph cards are responsive and are designed to reflow under browser zoom to reduce overlap between chart and summary content."
    ]
  },
  {
    id: "administrator-employees",
    category: "People And Records",
    title: "Employee Records And Lifecycle",
    points: [
      "Use the Employees page to search, filter, bulk update, export, and open individual employee records.",
      "Employee profile setup includes personal details, work details, reporting manager, salary, bank, and payroll-related information.",
      "Lifecycle actions support probation, confirmed, notice, and terminated flows depending on the employee stage.",
      "Use View Employee and edit pages to verify designation, department, shift, payroll, and document completeness before downstream actions."
    ]
  },
  {
    id: "administrator-approval-flows",
    category: "Approvals And Workflows",
    title: "Approval Flows And Pending Work",
    points: [
      "Approval Flows let you define multi-step approval chains using manager, role-based, or employee-based approvers.",
      "Pending Approvals consolidates actionable leave and attendance correction requests for the current approver.",
      "Flow order matters because each step can move the request forward, hold it in pending status, or finalize the decision.",
      "Use approval flows together with role permissions so the correct managers, HR users, or administrators can act on requests."
    ]
  },
  {
    id: "administrator-expenses",
    category: "Finance And Operations",
    title: "Expense Administration",
    points: [
      "Manage expenses through pending, approved, and rejected states.",
      "Upload receipts through Cloudinary-based file storage.",
      "Use filters for category, status, employee, reimbursement state, record type, and date range to narrow the expense register.",
      "Use vendor master data and vendor analytics for reporting and governance."
    ]
  },
  {
    id: "administrator-organization-settings",
    category: "Policies And Configuration",
    title: "Organization Settings And Policies",
    points: [
      "Organization Settings control timezone, leave credit behavior, sandwich rule, attendance lock day, attendance lock mode, and payroll-sensitive policy options.",
      "Changes to policy settings can affect leave calculation, attendance edit windows, and month-end payroll readiness.",
      "Review holiday setup, week off setup, leave types, and organization settings together because these modules influence one another."
    ],
    warnings: [
      "Policy changes can alter live calculations. Validate settings before changing them during an active payroll or leave cycle."
    ]
  },
  {
    id: "administrator-hiring",
    category: "People And Records",
    title: "Hiring Workflow",
    points: [
      "The Hiring module tracks jobs, candidates, interviews, offers, and status progression in one workflow.",
      "Use hiring permissions to separate view-only roles from managers who can schedule, evaluate, and close jobs.",
      "Candidate status, interview status, and final outcomes should be updated promptly so hiring dashboards and actions stay accurate."
    ]
  },
  {
    id: "administrator-projects-and-expenses",
    category: "Finance And Operations",
    title: "Projects, Vendors, And Financial Tracking",
    points: [
      "Projects can be used with employee and vendor data to track work ownership and related financial activity.",
      "Expense records should be reviewed with reimbursement status and employee ownership so approvals and payouts remain traceable.",
      "Keep vendor and project master data clean because those records feed reporting and operational summaries."
    ]
  },
  {
    id: "administrator-troubleshooting",
    category: "Troubleshooting",
    title: "Administrator Troubleshooting",
    checklist: [
      "If access is denied, verify active role and permission mapping",
      "If employee actions are blocked, verify lifecycle status, assigned role, and required master data such as department, designation, and shift",
      "If approvals are not visible, verify pending approvals and workflow configuration",
      "If approval chains behave unexpectedly, review approval flow step order and approver mapping",
      "If leave day calculation is incorrect, verify holidays, weekly off policies, and sandwich rule settings",
      "If Leave Management rows do not match expectation, verify both month and status filters at the top of the page",
      "If approver or rejector details are missing in Leave Management, confirm the leave was actioned by a valid employee record with designation data",
      "If attendance shows pending checkout with approved half-day leave, check for PL state and reconciliation note in hover details",
      "If dashboard graphs overlap while zoomed, reduce browser zoom or switch between graphical and data view based on the available screen width",
      "If timesheet actions are missing, verify the selected week, status, and the permissions for submit, recall, or approve",
      "If payroll totals look incorrect, confirm attendance snapshot month, finalized leave approvals, salary setup, and selected pay group",
      "If receipt upload fails, verify Cloudinary credentials in environment configuration",
      "If payroll shows missing bank details, complete employee bank tab and recompute the run",
      "If payroll run creation shows duplicate month/group, continue using existing run for that pay month"
    ]
  }
];

const employeeSections: DocSection[] = [
  {
    id: "employee-overview",
    category: "Getting Started",
    title: "Employee Quick Start",
    points: [
      "Complete your profile before using core features.",
      "Use the dashboard for attendance summary, leave summary, and notifications.",
      "Use the side navigation menu for Attendance, Timesheets, Leave, Holidays, and Documentation.",
      "The dashboard can be switched between Data Representation and Graphical Representation depending on whether you prefer cards or charts."
    ]
  },
  {
    id: "employee-attendance",
    category: "Daily Use",
    title: "Attendance Guide",
    points: [
      "Record check-in at shift start and record check-out at shift end.",
      "Late arrival and early activity indicators are calculated from shift timing and grace minutes.",
      "If check-out is missed, submit an attendance correction request.",
      "The Attendance page supports month-wise review through the month picker.",
      "The Attendance page can show PL when attendance and approved half-day leave exist on the same date."
    ],
    warnings: [
      "Employees cannot directly override attendance records."
    ]
  },
  {
    id: "employee-dashboard",
    category: "Daily Use",
    title: "Employee Dashboard Guide",
    points: [
      "My Dashboard highlights attendance summary, leave balances, pending items, notifications, and personal quick insights.",
      "Pending Requests cards can open details for leave and timesheet items that still need attention.",
      "Use dashboard shortcuts to move quickly into attendance, leave, or profile actions without opening the full modules first."
    ]
  },
  {
    id: "employee-leave",
    category: "Daily Use",
    title: "Leave Guide",
    points: [
      "Select leave type, duration, and date range when submitting a leave request.",
      "For half-day leave, choose the session (First Half or Second Half).",
      "Holidays and weekly off days are excluded unless sandwich rule includes in-between non-working days.",
      "Pending and approved leaves are visible in the leave calendar with distinct status colors.",
      "Leave Management defaults to the current month and supports month-wise review through the month picker.",
      "You can filter your leave list by status and month together to review only pending, approved, or rejected requests for a selected month.",
      "The Action By column shows who approved or rejected a leave request, and hovering the name can show that person's designation."
    ],
    warnings: [
      "Employees cannot approve their own leave requests."
    ]
  },
  {
    id: "employee-timesheet",
    category: "Daily Use",
    title: "Timesheet Guide",
    points: [
      "Submit weekly timesheet entries for approval.",
      "Timesheets can be edited while in draft or rejected status.",
      "Recall is available based on your permission set and timesheet status.",
      "Attendance requests and weekly submissions can appear together in approval-related views depending on your role."
    ]
  },
  {
    id: "employee-profile-and-notifications",
    category: "Profile And Communication",
    title: "Profile, Inbox, And Notifications",
    points: [
      "Keep your profile complete so approvals, payroll setup, and employee records remain accurate.",
      "Use Inbox or notification panels to review leave actions, attendance actions, and other workflow updates.",
      "If a manager, HR user, or administrator acts on your leave, the leave list can show the actioned-by name and designation in the Action By column."
    ]
  },
  {
    id: "employee-support",
    category: "Troubleshooting",
    title: "Issue Resolution Guidance",
    checklist: [
      "For profile or access issues, contact Human Resources or an administrator",
      "For dashboard confusion, switch between data and graphical view to use the layout that fits your screen better",
      "For leave delays, verify request status and approval chain",
      "For leave history mismatches, verify the selected month and status filters on the Leave Management page",
      "For missing approver or rejector details, open the request again after it has been fully approved or rejected",
      "For timesheet submission issues, verify the current week, draft status, and whether the submission window is still open",
      "For half-day leave errors, verify selected date is a working day and from/to date are the same",
      "For attendance mismatches, submit an attendance correction request with detailed reason",
      "For restricted menu access, confirm active role in the top navigation bar"
    ]
  }
];

const renderSection = (section: DocSection) => (
  <div key={section.id} className="bg-card rounded-xl card-shadow p-6">
    <h3 className="text-xl font-semibold mb-2">{section.title}</h3>

    {section.description && (
      <p className="text-sm text-muted-foreground mb-3">{section.description}</p>
    )}

    {section.points && section.points.length > 0 && (
      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1 mb-3">
        {section.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    )}

    {section.checklist && section.checklist.length > 0 && (
      <div className="mb-3">
        <p className="text-sm font-medium mb-2">Checklist</p>
        <ul className="list-decimal pl-5 text-sm text-muted-foreground space-y-1">
          {section.checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    )}

    {section.warnings && section.warnings.length > 0 && (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm space-y-1">
        {section.warnings.map((warn) => (
          <p key={warn}>{warn}</p>
        ))}
      </div>
    )}
  </div>
);

const Documentation = () => {
  const { profile } = useAuth();
  const isEmployeeRole = profile?.activeRole?.slug === "employee";

  const [guideMode, setGuideMode] = useState<"administrator" | "employee">(
    isEmployeeRole ? "employee" : "administrator"
  );

  const sections = useMemo(
    () => (guideMode === "administrator" ? administratorSections : employeeSections),
    [guideMode]
  );

  const sectionsByCategory = useMemo(() => {
    return sections.reduce<Record<string, DocSection[]>>((acc, section) => {
      if (!acc[section.category]) acc[section.category] = [];
      acc[section.category].push(section);
      return acc;
    }, {});
  }, [sections]);

  const [selectedId, setSelectedId] = useState(sections[0]?.id || "");
  const selected = sections.find((s) => s.id === selectedId) || sections[0];

  return (
    <MainLayout
      title="Documentation"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Documentation" }]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <aside className="lg:col-span-4 xl:col-span-3">
          <div className="bg-card rounded-xl card-shadow p-4 lg:sticky lg:top-20">
            <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                size="sm"
                variant={guideMode === "administrator" ? "default" : "outline"}
                className="w-full whitespace-normal text-center leading-tight"
                onClick={() => {
                  setGuideMode("administrator");
                  setSelectedId(administratorSections[0].id);
                }}
                disabled={isEmployeeRole}
              >
                Administrator Guide
              </Button>
              <Button
                size="sm"
                variant={guideMode === "employee" ? "default" : "outline"}
                className="w-full whitespace-normal text-center leading-tight"
                onClick={() => {
                  setGuideMode("employee");
                  setSelectedId(employeeSections[0].id);
                }}
              >
                Employee Guide
              </Button>
            </div>

            {isEmployeeRole && (
              <Badge variant="secondary" className="mb-3">
                Employee view
              </Badge>
            )}

            <h3 className="text-base font-semibold mb-3">Manual</h3>
            <div className="space-y-4 max-h-[65vh] overflow-auto pr-1">
              {Object.entries(sectionsByCategory).map(([category, categorySections]) => (
                <div key={category}>
                  <p className="px-2 mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {category}
                  </p>
                  <div className="space-y-1">
                    {categorySections.map((section) => (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => setSelectedId(section.id)}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                          selectedId === section.id
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        )}
                      >
                        {section.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <section className="lg:col-span-8 xl:col-span-9 space-y-5">
          {selected && renderSection(selected)}
        </section>
      </div>
    </MainLayout>
  );
};

export default Documentation;
