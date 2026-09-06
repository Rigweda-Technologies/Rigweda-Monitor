import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiWithToken, postApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type OrgLifecycleAction = "soft_delete" | "restore" | "hard_delete";
type PayrollClearMode = "generated" | "all";

const getApiErrorMessage = (response: any, fallback: string) =>
  String(response?.message || response?.error?.message || response?.data?.message || fallback);

const SuperAdminDashboard = () => {
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [designations, setDesignations] = useState<any[]>([]);
  const [managers, setManagers] = useState<any[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>("");

  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [showLifecycleDialog, setShowLifecycleDialog] = useState(false);
  const [showPayrollClearDialog, setShowPayrollClearDialog] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<OrgLifecycleAction>("soft_delete");
  const [payrollClearMode, setPayrollClearMode] = useState<PayrollClearMode>("generated");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [payrollClearConfirmationCode, setPayrollClearConfirmationCode] = useState("");
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [payrollClearLoading, setPayrollClearLoading] = useState(false);
  const [createOrgError, setCreateOrgError] = useState("");
  const [createUserError, setCreateUserError] = useState("");

  const [createOrgForm, setCreateOrgForm] = useState({
    name: "",
    code: "",
    timezone: "Asia/Kolkata",
    currency: "INR"
  });

  const [createUserForm, setCreateUserForm] = useState({
    email: "",
    password: "",
    roleIds: [] as string[],
    firstName: "",
    lastName: "",
    departmentId: "",
    designationId: "",
    employmentType: "",
    dateOfJoining: "",
    managerId: ""
  });

  const navigate = useNavigate();

  const fetchOrganizations = async () => {
    const res = await getApiWithToken("/organizations");
    if (res?.success) setOrganizations(res.data || []);
  };

  const switchOrganization = async (organizationId: string) => {
    const res = await postApiWithToken("/users/switch-org", { organizationId });
    if (!res?.success) {
      toast.error("Failed to switch organization");
      return;
    }
    setSelectedOrg(organizationId);
    fetchRoles();
    fetchDepartments();
    fetchDesignations();
    fetchManagers();
    toast.success("Organization context switched");
  };

  const fetchRoles = async () => {
    const res = await getApiWithToken("/roles");
    if (res?.success) setRoles(res.data || []);
  };

  const fetchDepartments = async () => {
    const res = await getApiWithToken("/departments");
    if (res?.success) setDepartments(res.data || []);
  };

  const fetchDesignations = async () => {
    const res = await getApiWithToken("/designations");
    if (res?.success) setDesignations(res.data || []);
  };

  const fetchManagers = async () => {
    const res = await getApiWithToken("/employees");
    if (res?.success) {
      const list = res.data?.items || [];
      setManagers(
        list.map((e: any) => ({
          _id: e._id,
          name: `${e.firstName || ""} ${e.lastName || ""}`.trim()
        }))
      );
    }
  };

  const handleCreateOrganization = async () => {
    setCreateOrgError("");
    const res = await postApiWithToken("/organizations", createOrgForm);
    if (res?.success) {
      toast.success("Organization created");
      setShowCreateOrg(false);
      setCreateOrgForm({
        name: "",
        code: "",
        timezone: "Asia/Kolkata",
        currency: "INR"
      });
      fetchOrganizations();
    } else {
      const message = getApiErrorMessage(res, "Create organization failed");
      setCreateOrgError(message);
      toast.error(message);
    }
  };

  const handleCreateUser = async () => {
    setCreateUserError("");
    if (!selectedOrg) {
      toast.error("Select an organization first");
      return;
    }
    if (
      !createUserForm.email ||
      !createUserForm.password ||
      !createUserForm.firstName ||
      !createUserForm.lastName ||
      !createUserForm.employmentType ||
      !createUserForm.dateOfJoining ||
      createUserForm.roleIds.length === 0
    ) {
      toast.error("All fields are required");
      return;
    }
    const res = await postApiWithToken("/users/org-user", createUserForm);
    if (res?.success) {
      toast.success("Admin user created");
      setShowCreateUser(false);
      setCreateUserForm({
        email: "",
        password: "",
        roleIds: [],
        firstName: "",
        lastName: "",
        departmentId: "",
        designationId: "",
        employmentType: "",
        dateOfJoining: "",
        managerId: ""
      });
    } else {
      const message = getApiErrorMessage(res, "User creation failed");
      setCreateUserError(message);
      toast.error(message);
    }
  };

  const handleLifecycleAction = async () => {
    if (!selectedOrg || !selectedOrgDetails) {
      toast.error("Select an organization first");
      return;
    }
    if (!confirmationCode.trim()) {
      toast.error("Enter organization code for confirmation");
      return;
    }

    setLifecycleLoading(true);
    const res = await postApiWithToken(`/organizations/${selectedOrg}/lifecycle`, {
      action: lifecycleAction,
      confirmationCode: confirmationCode.trim()
    });
    setLifecycleLoading(false);

    if (!res?.success) {
      toast.error(res?.message || "Organization lifecycle action failed");
      return;
    }

    if (lifecycleAction === "hard_delete") {
      toast.success("Organization hard deleted");
      setSelectedOrg("");
    } else if (lifecycleAction === "restore") {
      toast.success("Organization restored");
    } else {
      toast.success("Organization marked as deleted");
    }
    setShowLifecycleDialog(false);
    setConfirmationCode("");
    await fetchOrganizations();
  };

  const handlePayrollClearAction = async () => {
    if (!selectedOrg || !selectedOrgDetails) {
      toast.error("Select an organization first");
      return;
    }
    if (!payrollClearConfirmationCode.trim()) {
      toast.error("Enter organization code for confirmation");
      return;
    }

    setPayrollClearLoading(true);
    const res = await postApiWithToken(`/organizations/${selectedOrg}/payroll-clear`, {
      mode: payrollClearMode,
      confirmationCode: payrollClearConfirmationCode.trim()
    });
    setPayrollClearLoading(false);

    if (!res?.success) {
      toast.error(res?.message || "Organization payroll clear failed");
      return;
    }

    toast.success(
      payrollClearMode === "all"
        ? "Full payroll reset completed for selected organization"
        : "Generated payroll data cleared for selected organization"
    );
    setShowPayrollClearDialog(false);
    setPayrollClearConfirmationCode("");
  };

  useEffect(() => {
    fetchOrganizations();
  }, []);

  const selectedOrgDetails = useMemo(
    () => organizations.find((org) => org._id === selectedOrg),
    [organizations, selectedOrg]
  );

  return (
    <MainLayout title="Super Admin" breadcrumb={[{ label: "Home" }, { label: "Super Admin" }]}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card rounded-xl card-shadow p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold">Organizations</h3>
              <p className="text-sm text-muted-foreground">Select an org to manage roles and users.</p>
            </div>
            <Button onClick={() => setShowCreateOrg(true)}>+ Create Organization</Button>
          </div>

          <div className="space-y-3">
            {organizations.map((org) => (
              <div
                key={org._id}
                className={`border rounded-lg px-4 py-3 cursor-pointer transition ${
                  selectedOrg === org._id ? "bg-muted" : "hover:bg-muted"
                }`}
                onClick={() => switchOrganization(org._id)}
              >
                <div className="font-medium flex items-center justify-between gap-2">
                  <span>{org.name}</span>
                  <span
                    className={`text-xs px-2 py-1 rounded border ${
                      org.isSoftDeleted
                        ? "bg-red-100 text-red-700 border-red-200"
                        : org.status === "inactive"
                          ? "bg-amber-100 text-amber-700 border-amber-200"
                          : "bg-emerald-100 text-emerald-700 border-emerald-200"
                    }`}
                  >
                    {org.isSoftDeleted ? "Deleted" : org.status === "inactive" ? "Inactive" : "Active"}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {org.code} • {org.timezone}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-xl card-shadow p-6">
          <h3 className="text-lg font-semibold mb-2">Admin Setup</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create an admin user for the selected organization.
          </p>

          <div className="space-y-3 mb-4">
            <div className="text-sm">Selected Org</div>
            <div className="font-medium">
              {selectedOrgDetails?.name || "No organization selected"}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button onClick={() => setShowCreateUser(true)} disabled={!selectedOrg}>
              Add Admin User
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate(`/employees?organizationId=${selectedOrg}`)}
              disabled={!selectedOrg}
            >
              View Employees
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPayrollClearMode("generated");
                setPayrollClearConfirmationCode("");
                setShowPayrollClearDialog(true);
              }}
              disabled={!selectedOrg}
            >
              Clear Payroll Data
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setLifecycleAction(selectedOrgDetails?.isSoftDeleted ? "restore" : "soft_delete");
                setConfirmationCode("");
                setShowLifecycleDialog(true);
              }}
              disabled={!selectedOrg}
            >
              Manage Delete / Restore
            </Button>
          </div>
        </div>
      </div>

      <Sheet open={showCreateOrg} onOpenChange={setShowCreateOrg}>
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">Create Organization</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {createOrgError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {createOrgError}
              </div>
            )}
            <Input
              placeholder="Organization Name"
              validationType="name"
              value={createOrgForm.name}
              onChange={(e) => setCreateOrgForm({ ...createOrgForm, name: e.target.value })}
            />
            <Input
              placeholder="Code"
              validationType="code"
              value={createOrgForm.code}
              onChange={(e) => setCreateOrgForm({ ...createOrgForm, code: e.target.value })}
            />
            <Input
              placeholder="Timezone"
              value={createOrgForm.timezone}
              onChange={(e) => setCreateOrgForm({ ...createOrgForm, timezone: e.target.value })}
            />
            <Input
              placeholder="Currency"
              value={createOrgForm.currency}
              onChange={(e) => setCreateOrgForm({ ...createOrgForm, currency: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setShowCreateOrg(false)}>Cancel</Button>
            <Button onClick={handleCreateOrganization}>Create</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={showCreateUser} onOpenChange={setShowCreateUser}>
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">Create Admin User</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {createUserError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {createUserError}
              </div>
            )}
            <Input
              placeholder="First Name"
              validationType="name"
              value={createUserForm.firstName}
              onChange={(e) => setCreateUserForm({ ...createUserForm, firstName: e.target.value })}
            />
            <Input
              placeholder="Last Name"
              validationType="name"
              value={createUserForm.lastName}
              onChange={(e) => setCreateUserForm({ ...createUserForm, lastName: e.target.value })}
            />
            <Input
              placeholder="Email"
              validationType="email"
              value={createUserForm.email}
              onChange={(e) => setCreateUserForm({ ...createUserForm, email: e.target.value })}
            />
            <Input
              placeholder="Password"
              type="password"
              value={createUserForm.password}
              onChange={(e) => setCreateUserForm({ ...createUserForm, password: e.target.value })}
            />
            <Select
              value={createUserForm.departmentId}
              onValueChange={(value) => {
                if (value === "__create__") {
                  navigate("/departments");
                  return;
                }
                setCreateUserForm({ ...createUserForm, departmentId: value });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__create__">+ Create Department</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept._id} value={dept._id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={createUserForm.designationId}
              onValueChange={(value) => {
                if (value === "__create__") {
                  navigate("/designations");
                  return;
                }
                setCreateUserForm({ ...createUserForm, designationId: value });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Designation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__create__">+ Create Designation</SelectItem>
                {designations.map((des) => (
                  <SelectItem key={des._id} value={des._id}>
                    {des.name || des.departmentName || des._id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={createUserForm.roleIds[0] || ""}
              onValueChange={(value) => setCreateUserForm({ ...createUserForm, roleIds: [value] })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select Role" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role._id} value={role._id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={createUserForm.employmentType}
              onValueChange={(value) => setCreateUserForm({ ...createUserForm, employmentType: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Employment Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full Time</SelectItem>
                <SelectItem value="part_time">Part Time</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              placeholder="Date of Joining"
              value={createUserForm.dateOfJoining}
              onChange={(e) => setCreateUserForm({ ...createUserForm, dateOfJoining: e.target.value })}
            />
            <Select
              value={createUserForm.managerId}
              onValueChange={(value) =>
                setCreateUserForm({ ...createUserForm, managerId: value === "none" ? "" : value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Reporting Manager (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m._id} value={m._id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setShowCreateUser(false)}>Cancel</Button>
            <Button onClick={handleCreateUser}>Create User</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={showLifecycleDialog} onOpenChange={setShowLifecycleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organization Lifecycle Action</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{selectedOrgDetails?.name || "-"}</div>
              <div className="text-muted-foreground">
                Code: {selectedOrgDetails?.code || "-"}
              </div>
              <div className="text-muted-foreground">
                Soft Delete only marks the organization as deleted so it can be restored later. Hard Delete permanently removes the organization, org settings, employees, leaves, attendance, payroll tenant data, and every organization-scoped record across the database.
              </div>
            </div>

            <Select
              value={lifecycleAction}
              onValueChange={(value) => setLifecycleAction(value as OrgLifecycleAction)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="soft_delete">Soft Delete (Mark as Deleted)</SelectItem>
                <SelectItem value="restore">Restore</SelectItem>
                <SelectItem value="hard_delete">Hard Delete (Permanent)</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder={`Type org code (${selectedOrgDetails?.code || ""}) to confirm`}
              value={confirmationCode}
              onChange={(e) => setConfirmationCode(e.target.value)}
            />

            <Button
              className="w-full"
              variant={lifecycleAction === "hard_delete" ? "destructive" : "default"}
              onClick={handleLifecycleAction}
              disabled={lifecycleLoading || !selectedOrg}
            >
              {lifecycleLoading
                ? "Processing..."
                : lifecycleAction === "hard_delete"
                  ? "Confirm Hard Delete"
                  : lifecycleAction === "restore"
                    ? "Confirm Restore"
                    : "Confirm Soft Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPayrollClearDialog} onOpenChange={setShowPayrollClearDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Organization Payroll Data</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{selectedOrgDetails?.name || "-"}</div>
              <div className="text-muted-foreground">
                Code: {selectedOrgDetails?.code || "-"}
              </div>
              <div className="text-muted-foreground">
                Generated Data Only clears attendance snapshots, payroll runs, run rows, and payroll transactions for the selected organization. Full Payroll Reset also clears pay groups, components, payroll employee setup, salary, bank, and statutory payroll records for that organization.
              </div>
            </div>

            <Select
              value={payrollClearMode}
              onValueChange={(value) => setPayrollClearMode(value as PayrollClearMode)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select payroll clear mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generated">Generated Data Only</SelectItem>
                <SelectItem value="all">Full Payroll Reset</SelectItem>
              </SelectContent>
            </Select>

            <Input
              placeholder={`Type org code (${selectedOrgDetails?.code || ""}) to confirm`}
              value={payrollClearConfirmationCode}
              onChange={(e) => setPayrollClearConfirmationCode(e.target.value)}
            />

            <Button
              className="w-full"
              variant="destructive"
              onClick={handlePayrollClearAction}
              disabled={payrollClearLoading || !selectedOrg}
            >
              {payrollClearLoading
                ? "Processing..."
                : payrollClearMode === "all"
                  ? "Confirm Full Payroll Reset"
                  : "Confirm Generated Payroll Clear"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default SuperAdminDashboard;
