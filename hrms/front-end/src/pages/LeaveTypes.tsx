import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, Column } from "@/components/ui/DataTable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import PermissionGate from "@/components/PermissionGate";
import {
  deleteApiWithToken,
  getApiWithToken,
  postApiWithToken,
  putApiWithToken
} from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";

interface LeaveType {
  _id?: string;
  name: string;
  code: string;
  description?: string;
  daysPerYear: number;
  isCarryForward: boolean;
  includeInPayroll: boolean;
  maxCarryForward?: number | null;
  status: "active" | "inactive";
}

const emptyLeaveType: LeaveType = {
  name: "",
  code: "",
  description: "",
  daysPerYear: 0,
  isCarryForward: false,
  includeInPayroll: true,
  maxCarryForward: null,
  status: "active"
};

const LeaveTypes = () => {
  const { hasAnyPermission } = useAuth();
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<LeaveType>(emptyLeaveType);
  const canView = hasAnyPermission(["LEAVE_TYPE_VIEW"]);
  const canManage = hasAnyPermission(["LEAVE_TYPE_MANAGE"]);

  const fetchLeaveTypes = async () => {
    const response = await getApiWithToken("/leave-types", null, {
      requiredPermissions: ["LEAVE_TYPE_VIEW"]
    });
    if (response?.skipped) {
      setLeaveTypes([]);
      return;
    }
    if (response?.code === 200 || response?.success) {
      setLeaveTypes(response.data || []);
    } else {
      toast.error(response?.message || "Failed to load leave types");
    }
  };

  useEffect(() => {
    fetchLeaveTypes();
  }, []);

  const handleDelete = async (id: string) => {
    const currentLeaveType = leaveTypes.find((leaveType) => leaveType._id === id);
    if (currentLeaveType?.status === "inactive") {
      toast.info("Leave type is already inactive");
      return;
    }
    if (!window.confirm("Mark this leave type as inactive?")) return;
    if (!canManage) {
      toast.error("You do not have permission to delete");
      return;
    }
    const res = await deleteApiWithToken(`/leave-types/${id}`);
    if (res?.success) {
      toast.success("Leave type marked as inactive");
      fetchLeaveTypes();
    } else {
      toast.error(res?.message || "Delete failed");
    }
  };

  const handleSubmit = async () => {
    if (!canManage) {
      toast.error("You do not have permission to manage leave types");
      return;
    }
    const payload = {
      name: form.name,
      code: form.code,
      description: form.description || "",
      daysPerYear: Number(form.daysPerYear) || 0,
      isCarryForward: Boolean(form.isCarryForward),
      includeInPayroll: Boolean(form.includeInPayroll),
      maxCarryForward: form.isCarryForward
        ? Number(form.maxCarryForward || 0)
        : null,
      status: form.status
    };

    let res;
    if (isEdit && form._id) {
      res = await putApiWithToken(`/leave-types/${form._id}`, payload, null, {
        requiredPermissions: ["LEAVE_TYPE_MANAGE"]
      });
    } else {
      res = await postApiWithToken("/leave-types", payload, null, {
        requiredPermissions: ["LEAVE_TYPE_MANAGE"]
      });
    }
    if (res?.skipped) return;

    if (res?.success) {
      toast.success(isEdit ? "Leave type updated" : "Leave type created");
      setOpen(false);
      setForm(emptyLeaveType);
      fetchLeaveTypes();
    } else {
      toast.error(res?.message || "Operation failed");
    }
  };

  const columns: Column<LeaveType>[] = [
    { header: "Name", accessor: "name", sortable: true },
    { header: "Code", accessor: "code", sortable: true },
    {
      header: "Days",
      accessor: "daysPerYear",
      sortable: true
    },
    {
      header: "Carry Forward",
      accessor: "isCarryForward",
      render: (lt) => (lt.isCarryForward ? "Yes" : "No")
    },
    {
      header: "Payroll Payable",
      accessor: "includeInPayroll",
      render: (lt) => (lt.includeInPayroll === false ? "No" : "Yes")
    },
    {
      header: "Status",
      accessor: "status",
      render: (lt) => (
        <Badge
          variant={lt.status === "active" ? "default" : "secondary"}
          className="capitalize"
        >
          {lt.status}
        </Badge>
      )
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (lt) => (
        <div className="flex gap-3">
          <PermissionGate permissions={["LEAVE_TYPE_MANAGE"]}>
            <Pencil
              className="w-4 h-4 text-emerald-600 cursor-pointer hover:scale-110"
              onClick={() => {
                setIsEdit(true);
                setForm({
                  ...lt,
                  includeInPayroll: lt.includeInPayroll !== false,
                  maxCarryForward: lt.maxCarryForward ?? null
                });
                setOpen(true);
              }}
            />
          </PermissionGate>
          <PermissionGate permissions={["LEAVE_TYPE_MANAGE"]}>
            <Trash2
              className={`w-4 h-4 ${
                lt.status === "inactive"
                  ? "text-red-300 cursor-not-allowed"
                  : "text-red-600 cursor-pointer hover:scale-110"
              }`}
              onClick={() => handleDelete(lt._id!)}
            />
          </PermissionGate>
        </div>
      )
    }
  ];

  return (
    <MainLayout
      title="Leave Types"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Organization" }, { label: "Leave Types" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view leave types.
        </div>
      )}
      {canView && (
        <>
          <div className="flex justify-end mb-6">
            <PermissionGate permissions={["LEAVE_TYPE_MANAGE"]}>
              <Button
                onClick={() => {
                  setIsEdit(false);
                  setForm(emptyLeaveType);
                  setOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Leave Type
              </Button>
            </PermissionGate>
          </div>

          <DataTable
            columns={canManage ? columns : columns.filter((c) => c.header !== "Actions")}
            data={leaveTypes}
            rowKey="_id"
            searchKey="name"
          />
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Leave Type" : "Add Leave Type"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <Input
              placeholder="Name"
              validationType="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              placeholder="Code"
              validationType="code"
              value={form.code}
              onChange={(e) =>
                setForm({ ...form, code: e.target.value.toUpperCase() })
              }
              disabled={isEdit}
            />
            <Input
              type="number"
              placeholder="Days per year"
              value={form.daysPerYear}
              onChange={(e) =>
                setForm({ ...form, daysPerYear: Number(e.target.value) })
              }
            />
            <Select
              value={form.status}
              onValueChange={(value) =>
                setForm({ ...form, status: value as "active" | "inactive" })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 space-y-3">
            <Input
              placeholder="Description"
              value={form.description || ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isCarryForward}
                onCheckedChange={(value) =>
                  setForm({ ...form, isCarryForward: Boolean(value) })
                }
              />
              Allow carry forward
            </label>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={form.includeInPayroll !== false}
                onCheckedChange={(value) =>
                  setForm({ ...form, includeInPayroll: Boolean(value) })
                }
              />
              <span>
                Include in payroll payable days
                <span className="block text-xs text-muted-foreground">
                  Approved leave is paid even when the employee has no attendance for that day.
                </span>
              </span>
            </label>
            <Input
              type="number"
              placeholder="Max carry forward"
              value={form.maxCarryForward ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  maxCarryForward:
                    e.target.value === "" ? null : Number(e.target.value)
                })
              }
              disabled={!form.isCarryForward}
            />
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {isEdit ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default LeaveTypes;
