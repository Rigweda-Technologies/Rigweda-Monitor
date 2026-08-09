import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { DataTable, Column } from "@/components/ui/DataTable";
import {
  getApiWithToken,
  postApiWithToken,
  deleteApiWithToken,
  putApiWithToken,
} from "@/services/apiWrapper";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Trash2, Plus, FilePenLine, Eraser } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PermissionGate from "@/components/PermissionGate";
import { useAuth } from "@/context/useAuth";

interface Organization {
  _id?: string;
  name: string;
  code: string;
  timezone: string;
  currency: string;
  status: "active" | "inactive";
}

const emptyOrg: Organization = {
  name: "",
  code: "",
  timezone: "Asia/Kolkata",
  currency: "INR",
  status: "active",
};

const OrganizationPage = () => {
  const { hasAnyPermission, isSuperAdmin } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<Organization>(emptyOrg);
  const [payrollClearOpen, setPayrollClearOpen] = useState(false);
  const [selectedOrgForPayrollClear, setSelectedOrgForPayrollClear] = useState<Organization | null>(null);
  const [payrollClearMode, setPayrollClearMode] = useState<"generated" | "all">("generated");
  const [payrollClearConfirmationCode, setPayrollClearConfirmationCode] = useState("");
  const [payrollClearLoading, setPayrollClearLoading] = useState(false);
  const canView = hasAnyPermission(["ORG_VIEW"]);
  const canManage = hasAnyPermission(["ORG_MANAGE"]);

  const fetchOrganizations = async () => {
    const response = await getApiWithToken("/organizations", null, {
      requiredPermissions: ["ORG_VIEW"]
    });
    if (response?.skipped) {
      setOrganizations([]);
      return;
    }
    setOrganizations(response?.data || []);
  };

  useEffect(() => {
    fetchOrganizations();
  }, []);

  // 🗑 Delete
  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this organization?")) return;
    if (!canManage) {
      toast.error("You do not have permission to delete");
      return;
    }

    const res = await deleteApiWithToken(`/organizations/${id}`);
    if (res?.success) {
      toast.success("Organization deleted");
      fetchOrganizations();
    } else {
      toast.error(res?.message || "Delete failed");
    }
  };

  // 💾 Submit (ADD or EDIT)
  const handleSubmit = async () => {
    if (!canManage) {
      toast.error("You do not have permission to manage organizations");
      return;
    }
    // common fields
    const basePayload = {
      name: form.name,
      timezone: form.timezone,
      currency: form.currency,
      status: form.status,
    };

    let res;

    if (isEdit && form._id) {
      // ❌ DO NOT SEND code while updating
      res = await postApiWithToken(
        `/organizations/${form._id}`,
        basePayload,
        null,
        { requiredPermissions: ["ORG_MANAGE"] }
      );
    } else {
      // ✅ SEND code only while creating
      res = await postApiWithToken("/organizations", {
        ...basePayload,
        code: form.code,
      }, null, { requiredPermissions: ["ORG_MANAGE"] });
    }
    if (res?.skipped) return;

    if (res?.success) {
      toast.success(
        isEdit ? "Organization updated" : "Organization created"
      );
      setOpen(false);
      setForm(emptyOrg);
      fetchOrganizations();
    } else {
      toast.error(res?.message || "Operation failed");
    }
  };

  const openPayrollClearDialog = (org: Organization) => {
    setSelectedOrgForPayrollClear(org);
    setPayrollClearMode("generated");
    setPayrollClearConfirmationCode("");
    setPayrollClearOpen(true);
  };

  const handlePayrollClear = async () => {
    if (!selectedOrgForPayrollClear?._id) return;
    if (!isSuperAdmin) {
      toast.error("Only SuperAdmin can clear payroll data");
      return;
    }
    try {
      setPayrollClearLoading(true);
      const res = await postApiWithToken(
        `/organizations/${selectedOrgForPayrollClear._id}/payroll-clear`,
        {
          mode: payrollClearMode,
          confirmationCode: payrollClearConfirmationCode
        },
        null,
        { requiredPermissions: ["ORG_MANAGE"] }
      );
      if (res?.skipped) return;
      if (!res?.success) {
        toast.error(res?.message || "Failed to clear payroll data");
        return;
      }
      toast.success(
        payrollClearMode === "all"
          ? "Full payroll reset completed for organization"
          : "Generated payroll data cleared for organization"
      );
      setPayrollClearOpen(false);
      setSelectedOrgForPayrollClear(null);
      setPayrollClearConfirmationCode("");
    } finally {
      setPayrollClearLoading(false);
    }
  };

  const columns: Column<Organization>[] = [
    { header: "Name", accessor: "name", sortable: true },
    { header: "Code", accessor: "code", sortable: true },
    { header: "Timezone", accessor: "timezone" },
    { header: "Currency", accessor: "currency" },
    {
      header: "Status",
      accessor: "status",
      render: (org) => (
        <Badge className="capitalize">
          {org.status || "active"}
        </Badge>
      ),
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (org) => {
        const isInactive = org.status === "inactive";

        return (
          <PermissionGate permissions={["ORG_MANAGE"]} fallback={<div className="text-muted-foreground text-sm">-</div>}>
          <div className="flex items-center gap-4">
            {/* ✏️ Edit */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <FilePenLine
                    className={`
          w-4 h-4 transition-all duration-200
          ${isInactive
                        ? "text-gray-400 cursor-not-allowed"
                        : `
                cursor-pointer
                text-blue-600
                hover:text-blue-700
                hover:scale-110
                hover:-translate-y-0.5
              `
                      }
        `}
                    onClick={() => {
                      if (isInactive) return;
                      setIsEdit(true);
                      setForm(org);
                      setOpen(true);
                    }}
                  />
                </TooltipTrigger>

                <TooltipContent>
                  {isInactive
                    ? "Inactive organizations cannot be edited"
                    : "Edit organization"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>


            {/* 🗑 Delete */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={`
          group
          ${isInactive
                        ? "text-gray-400 cursor-not-allowed"
                        : "text-red-500 hover:text-red-600 cursor-pointer"
                      }
        `}
                    onClick={() => {
                      if (isInactive) return;
                      handleDelete(org._id!);
                    }}
                  >
                    <Trash2
                      className={`
            w-4 h-4 transition-transform duration-200
            ${isInactive
                          ? ""
                          : "group-hover:-rotate-12 group-hover:scale-110"
                        }
          `}
                    />
                  </div>
                </TooltipTrigger>

                <TooltipContent>
                  {isInactive
                    ? "Inactive organizations cannot be deleted"
                    : "Delete organization"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {isSuperAdmin && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={`
                        group
                        ${isInactive
                          ? "text-gray-400 cursor-not-allowed"
                          : "text-amber-600 hover:text-amber-700 cursor-pointer"
                        }
                      `}
                      onClick={() => {
                        if (isInactive) return;
                        openPayrollClearDialog(org);
                      }}
                    >
                      <Eraser
                        className={`
                          w-4 h-4 transition-transform duration-200
                          ${isInactive ? "" : "group-hover:scale-110"}
                        `}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isInactive
                      ? "Inactive organizations cannot clear payroll data"
                      : "Clear payroll data for this organization"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          </PermissionGate>
        );
      },
    }
  ];

  return (
    <MainLayout
      title="Organization"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Organization" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view organizations.
        </div>
      )}
      {/* ➕ Add Organization */}
      {/* <div className="flex justify-end mb-4">
        <Button
          onClick={() => {
            setIsEdit(false);
            setForm(emptyOrg);
            setOpen(true);
          }}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Organization
        </Button>
      </div> */}

      {canView && (
        <DataTable
          columns={canManage ? columns : columns.filter((c) => c.header !== "Actions")}
          data={organizations}
          rowKey="_id"
          searchKey="name"
          selectable
        />
      )}

      {/* 📝 Add/Edit Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit Organization" : "Add Organization"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              placeholder="Organization Name"
              validationType="name"
              value={form.name}
              onChange={(e) =>
                setForm({ ...form, name: e.target.value })
              }
            />
            <Input
              placeholder="Code"
              validationType="code"
              value={form.code}
              disabled={isEdit} // 🔒 locked in edit mode
              className={isEdit ? "cursor-not-allowed opacity-70" : ""}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value })
              }
            />
            <Select
              value={form.timezone}
              onValueChange={(value: string) =>
                setForm({ ...form, timezone: value })
              }>
              <SelectTrigger>
                <SelectValue placeholder="Select timezone" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Asia/Kolkata">
                  Asia/Kolkata (India)
                </SelectItem>
                <SelectItem value="America/New_York">
                  America/New_York (USA)
                </SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={form.currency}
              onValueChange={(value: "INR" | "USD") =>
                setForm({ ...form, currency: value })
              }>
              <SelectTrigger>
                <SelectValue placeholder="Select currency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INR">INR – Indian Rupee</SelectItem>
                <SelectItem value="USD">USD – US Dollar</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={form.status}
              onValueChange={(value: "active" | "inactive") =>
                setForm({ ...form, status: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleSubmit} className="w-full">
              {isEdit ? "Update Organization" : "Create Organization"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={payrollClearOpen} onOpenChange={setPayrollClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Organization Payroll Data</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{selectedOrgForPayrollClear?.name || "-"}</div>
              <div className="text-muted-foreground">
                Code: {selectedOrgForPayrollClear?.code || "-"}
              </div>
              <div className="text-muted-foreground">
                Generated Data Only clears payroll runs, snapshots, payroll transactions, and attendance sync data for this organization. Full Payroll Reset also removes pay groups, components, payroll employee setup, salary, bank, and statutory payroll records for this organization.
              </div>
            </div>

            <Select
              value={payrollClearMode}
              onValueChange={(value) => setPayrollClearMode(value as "generated" | "all")}
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
              placeholder={`Type org code (${selectedOrgForPayrollClear?.code || ""}) to confirm`}
              value={payrollClearConfirmationCode}
              onChange={(e) => setPayrollClearConfirmationCode(e.target.value)}
            />

            <Button
              className="w-full"
              variant="destructive"
              onClick={handlePayrollClear}
              disabled={payrollClearLoading || !selectedOrgForPayrollClear}
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

export default OrganizationPage;
