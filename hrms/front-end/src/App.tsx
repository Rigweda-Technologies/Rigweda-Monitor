import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet, Navigate } from "react-router-dom";
import React from "react";
import RequireAuth from "./components/RequireAuth";
import RoleBasedHome from "./components/RoleBasedHome";
import RequireProfile from "./components/RequireProfile";
import { MainLayout } from "@/components/layout/MainLayout";
import { RouteSkeleton } from "@/components/ui/loaders";
import { getIsSuperAdmin, getToken } from "@/utils/auth";
import { lazyWithRetry } from "@/utils/lazyWithRetry";

const Dashboard = lazyWithRetry(() => import("./pages/Dashboard"), "Dashboard");
const SuperAdminDashboard = lazyWithRetry(() => import("./pages/SuperAdminDashboard"), "SuperAdminDashboard");
const Employees = lazyWithRetry(() => import("./pages/Employees"), "Employees");
const AddEmployee = lazyWithRetry(() => import("./pages/AddEmployee"), "AddEmployee");
const ViewEmployee = lazyWithRetry(() => import("./pages/ViewEmployee"), "ViewEmployee");
const EmployeeAttendanceDetails = lazyWithRetry(() => import("./pages/EmployeeAttendanceDetails"), "EmployeeAttendanceDetails");
const EmployeeLeaveDetails = lazyWithRetry(() => import("./pages/EmployeeLeaveDetails"), "EmployeeLeaveDetails");
const EmployeeOverviewDetails = lazyWithRetry(() => import("./pages/EmployeeOverviewDetails"), "EmployeeOverviewDetails");
const DashboardGraphDetails = lazyWithRetry(() => import("./pages/DashboardGraphDetails"), "DashboardGraphDetails");
const Attendance = lazyWithRetry(() => import("./pages/Attendance"), "Attendance");
const EmployeeDashboard = lazyWithRetry(() => import("./pages/EmployeeDashboard"), "EmployeeDashboard");
const EmployeePayslips = lazyWithRetry(() => import("./pages/EmployeePayslips"), "EmployeePayslips");
const Timesheets = lazyWithRetry(() => import("./pages/Timesheets"), "Timesheets");
const Leave = lazyWithRetry(() => import("./pages/Leave"), "Leave");
const LeaveApply = lazyWithRetry(() => import("./pages/LeaveApply"), "LeaveApply");
const Holidays = lazyWithRetry(() => import("./pages/Holidays"), "Holidays");
const WeekOffs = lazyWithRetry(() => import("./pages/WeekOffs"), "WeekOffs");
const Payroll = lazyWithRetry(() => import("./pages/Payroll"), "Payroll");
const PayrollSetup = lazyWithRetry(() => import("./pages/PayrollSetup"), "PayrollSetup");
const PayrollEmployees = lazyWithRetry(() => import("./pages/PayrollEmployees"), "PayrollEmployees");
const PayrollRuns = lazyWithRetry(() => import("./pages/PayrollRuns"), "PayrollRuns");
const PayrollEmployeeBreakdown = lazyWithRetry(() => import("./pages/PayrollEmployeeBreakdown"), "PayrollEmployeeBreakdown");
const PerformanceDashboard = lazyWithRetry(() => import("./pages/PerformanceDashboard"), "PerformanceDashboard");
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"), "ProfilePage");
const Organization = lazyWithRetry(() => import("./pages/Organization"), "Organization");
const AddOrganization = lazyWithRetry(() => import("./pages/AddOrganization"), "AddOrganization");
const OrganizationSettings = lazyWithRetry(() => import("./pages/OrganizationSettings"), "OrganizationSettings");
const OrganizationDocuments = lazyWithRetry(() => import("./pages/OrganizationDocuments"), "OrganizationDocuments");
const NotFound = lazyWithRetry(() => import("./pages/NotFound"), "NotFound");
const Roles = lazyWithRetry(() => import("./pages/Roles"), "Roles");
const AddRole = lazyWithRetry(() => import("./pages/AddRole"), "AddRole");
const Permissions = lazyWithRetry(() => import("./pages/Permissions"), "Permissions");
const Login = lazyWithRetry(() => import("./pages/Login"), "Login");
const ForgotPassword = lazyWithRetry(() => import("./pages/ForgotPassword"), "ForgotPassword");
const ChangePassword = lazyWithRetry(() => import("./pages/ChangePassword"), "ChangePassword");
const Departments = lazyWithRetry(() => import("./pages/Departments"), "Departments");
const AddDepartment = lazyWithRetry(() => import("./pages/AddDepartment"), "AddDepartment");
const Designations = lazyWithRetry(() => import("./pages/Designations"), "Designations");
const AddDesignation = lazyWithRetry(() => import("./pages/AddDesignation"), "AddDesignation");
const LeaveTypes = lazyWithRetry(() => import("./pages/LeaveTypes"), "LeaveTypes");
const Shifts = lazyWithRetry(() => import("./pages/Shifts"), "Shifts");
const ApprovalFlows = lazyWithRetry(() => import("./pages/ApprovalFlows"), "ApprovalFlows");
const PendingApprovals = lazyWithRetry(() => import("./pages/PendingApprovals"), "PendingApprovals");
const CompleteProfile = lazyWithRetry(() => import("./pages/CompleteProfile"), "CompleteProfile");
const Documentation = lazyWithRetry(() => import("./pages/Documentation"), "Documentation");
const Expenses = lazyWithRetry(() => import("./pages/Expenses"), "Expenses");
const Projects = lazyWithRetry(() => import("./pages/Projects"), "Projects");
const Hiring = lazyWithRetry(() => import("./pages/Hiring"), "Hiring");
const EmployeeTree = lazyWithRetry(() => import("./pages/EmployeeTree"), "EmployeeTree");

const queryClient = new QueryClient();

const PublicOnlyRoute = ({ children }: { children: JSX.Element }) => {
  const token = getToken();
  if (token) {
    return <Navigate to={getIsSuperAdmin() ? "/superadmin" : "/"} replace />;
  }
  return children;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <React.Suspense fallback={<RouteSkeleton />}>
        <Routes>
          <Route path="/" element={<RoleBasedHome />} />
          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <Login />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PublicOnlyRoute>
                <ForgotPassword />
              </PublicOnlyRoute>
            }
          />
          <Route element={<MainLayout><Outlet /></MainLayout>}>
            <Route
              path="/complete-profile"
              element={
                <RequireAuth>
                  <CompleteProfile />
                </RequireAuth>
              }
            />
            <Route
              path="/superadmin"
              element={
                <RequireAuth>
                  <SuperAdminDashboard />
                </RequireAuth>
              }
            />
            <Route
              path="/dashboard"
              element={
                <RequireAuth permissions={["ORG_VIEW", "EMP_VIEW", "ROLE_VIEW", "LEAVE_VIEW_ALL", "TIMESHEET_VIEW_ALL"]}>
                  <RequireProfile>
                    <Dashboard />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/employee-dashboard"
              element={
                <RequireAuth permissions={["TIMESHEET_VIEW_SELF", "LEAVE_VIEW_SELF", "EMP_SELF_VIEW"]}>
                  <RequireProfile>
                    <EmployeeDashboard />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/employee-dashboard/payslips"
              element={
                <RequireAuth permissions={["EMP_SELF_VIEW"]}>
                  <RequireProfile>
                    <EmployeePayslips />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/employees"
              element={
                <RequireAuth permissions={["EMP_VIEW"]}>
                  <RequireProfile>
                    <Employees />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/employees/add"
              element={
                <RequireAuth permissions={["EMP_CREATE"]}>
                  <RequireProfile>
                    <AddEmployee />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/employees/edit/:id"
              element={
                <RequireAuth permissions={["EMP_VIEW", "EMP_UPDATE"]}>
                  <RequireProfile>
                    <AddEmployee />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/employees/:id"
              element={
                <RequireAuth permissions={["EMP_VIEW", "EMP_UPDATE"]}>
                  <RequireProfile>
                    <ViewEmployee />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/dashboard/graph/:graphKey"
              element={
                <RequireAuth permissions={["ORG_VIEW", "EMP_VIEW", "ROLE_VIEW", "LEAVE_VIEW_ALL", "TIMESHEET_VIEW_ALL"]}>
                  <RequireProfile>
                    <DashboardGraphDetails />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/dashboard/employee/:id"
              element={
                <RequireAuth permissions={["EMP_VIEW", "ATTENDANCE_VIEW_ALL", "LEAVE_VIEW_ALL"]}>
                  <RequireProfile>
                    <EmployeeOverviewDetails />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/dashboard/attendance/:id"
              element={
                <RequireAuth permissions={["ATTENDANCE_VIEW_ALL", "TIMESHEET_VIEW_ALL", "EMP_VIEW"]}>
                  <RequireProfile>
                    <EmployeeAttendanceDetails />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/dashboard/leaves/:id"
              element={
                <RequireAuth permissions={["LEAVE_VIEW_ALL", "EMP_VIEW"]}>
                  <RequireProfile>
                    <EmployeeLeaveDetails />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/attendance"
              element={
                <RequireAuth permissions={["ATTENDANCE_VIEW_ALL", "ATTENDANCE_VIEW_SELF"]}>
                  <RequireProfile>
                    <Attendance />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/timesheets"
              element={
                <RequireAuth permissions={["TIMESHEET_VIEW_SELF", "TIMESHEET_VIEW_ALL"]}>
                  <RequireProfile>
                    <Timesheets />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/leave"
              element={
                <RequireAuth permissions={["LEAVE_VIEW_ALL", "LEAVE_VIEW_SELF", "LEAVE_APPLY"]}>
                  <RequireProfile>
                    <Leave />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/leave/apply"
              element={
                <RequireAuth permissions={["LEAVE_APPLY"]}>
                  <RequireProfile>
                    <LeaveApply />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/holidays"
              element={
                <RequireAuth permissions={["HOLIDAY_VIEW", "LEAVE_VIEW_SELF", "LEAVE_APPLY"]}>
                  <RequireProfile>
                    <Holidays />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/week-offs"
              element={
                <RequireAuth permissions={["WEEK_OFF_VIEW"]}>
                  <RequireProfile>
                    <WeekOffs />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/shifts"
              element={
                <RequireAuth permissions={["SHIFT_VIEW"]}>
                  <RequireProfile>
                    <Shifts />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/payroll"
              element={
                <RequireAuth>
                  <RequireProfile>
                    <Payroll />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/payroll/setup"
              element={
                <RequireAuth>
                  <RequireProfile>
                    <PayrollSetup />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/payroll/employees"
              element={
                <RequireAuth>
                  <RequireProfile>
                    <PayrollEmployees />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/payroll/runs"
              element={
                <RequireAuth>
                  <RequireProfile>
                    <PayrollRuns />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/payroll/employee-breakdown"
              element={
                <RequireAuth>
                  <RequireProfile>
                    <PayrollEmployeeBreakdown />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/performance"
              element={
                <RequireAuth>
                  <RequireProfile>
                    <PerformanceDashboard />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireAuth>
                  <RequireProfile>
                    <ProfilePage />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/change-password"
              element={
                <RequireAuth>
                  <ChangePassword />
                </RequireAuth>
              }
            />
            <Route
              path="/organization"
              element={
                <RequireAuth permissions={["ORG_VIEW"]}>
                  <RequireProfile>
                    <Organization />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/organization/settings"
              element={
                <RequireAuth permissions={["ORG_SETTINGS_VIEW"]}>
                  <RequireProfile>
                    <OrganizationSettings />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/organization/documents"
              element={
                <RequireAuth permissions={["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]}>
                  <RequireProfile>
                    <OrganizationDocuments />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            
            <Route
              path="/organization/add"
              element={
                <RequireAuth permissions={["ORG_MANAGE"]}>
                  <RequireProfile>
                    <AddOrganization />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/organization/edit/:id"
              element={
                <RequireAuth permissions={["ORG_MANAGE"]}>
                  <RequireProfile>
                    <AddOrganization />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/roles"
              element={
                <RequireAuth permissions={["ROLE_VIEW"]}>
                  <RequireProfile>
                    <Roles />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/roles/add"
              element={
                <RequireAuth permissions={["ROLE_CREATE"]}>
                  <RequireProfile>
                    <AddRole />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/roles/edit/:id"
              element={
                <RequireAuth permissions={["ROLE_UPDATE"]}>
                  <RequireProfile>
                    <AddRole />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/permissions"
              element={
                <RequireAuth permissions={["PERMISSION_VIEW"]}>
                  <RequireProfile>
                    <Permissions />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/departments"
              element={
                <RequireAuth permissions={["DEPT_VIEW"]}>
                  <RequireProfile>
                    <Departments />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/departments/add"
              element={
                <RequireAuth permissions={["DEPT_CREATE"]}>
                  <RequireProfile>
                    <AddDepartment />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/departments/edit/:id"
              element={
                <RequireAuth permissions={["DEPT_UPDATE"]}>
                  <RequireProfile>
                    <AddDepartment />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/designations"
              element={
                <RequireAuth permissions={["DESIG_VIEW"]}>
                  <RequireProfile>
                    <Designations />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/designations/add"
              element={
                <RequireAuth permissions={["DESIG_CREATE"]}>
                  <RequireProfile>
                    <AddDesignation />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/designations/edit/:id"
              element={
                <RequireAuth permissions={["DESIG_UPDATE"]}>
                  <RequireProfile>
                    <AddDesignation />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/leave-types"
              element={
                <RequireAuth permissions={["LEAVE_TYPE_VIEW"]}>
                  <RequireProfile>
                    <LeaveTypes />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/approval-flows"
              element={
                <RequireAuth permissions={["APPROVAL_FLOW_VIEW"]}>
                  <RequireProfile>
                    <ApprovalFlows />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/documentation"
              element={
                <RequireAuth>
                  <RequireProfile>
                    <Documentation />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/expenses"
              element={
                <RequireAuth permissions={["EXPENSE_VIEW", "EXPENSE_MANAGE"]}>
                  <RequireProfile>
                    <Expenses />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/business-development"
              element={
                <RequireAuth permissions={["PROJECT_VIEW", "PROJECT_MANAGE"]}>
                  <RequireProfile>
                    <Projects />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/hiring"
              element={
                <RequireAuth permissions={["HIRING_VIEW", "HIRING_MANAGE"]}>
                  <RequireProfile>
                    <Hiring />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route
              path="/employee-tree"
              element={
                <RequireAuth permissions={["EMP_VIEW", "EMP_ORG_TREE_VIEW", "EMP_SELF_VIEW"]}>
                  <RequireProfile>
                    <EmployeeTree />
                  </RequireProfile>
                </RequireAuth>
              }
            />
            <Route path="/projects" element={<Navigate to="/business-development" replace />} />
            <Route
              path="/approvals"
              element={
                <RequireAuth permissions={["LEAVE_ACTION", "ATTENDANCE_MANAGE"]}>
                  <RequireProfile>
                    <PendingApprovals />
                  </RequireProfile>
                </RequireAuth>
              }
            />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </React.Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
