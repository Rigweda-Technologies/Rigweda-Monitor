import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarDays, Coins, Plus, Search, Pencil, Trash2 } from "lucide-react";
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
  const [searchQuery, setSearchQuery] = useState("");
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

  const filteredLeaveTypes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return leaveTypes;
    return leaveTypes.filter((leaveType) =>
      [leaveType.name, leaveType.code, leaveType.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [leaveTypes, searchQuery]);

  const activeCount = leaveTypes.filter((leaveType) => leaveType.status === "active").length;
  const carryForwardCount = leaveTypes.filter((leaveType) => leaveType.isCarryForward).length;
  const payrollPayableCount = leaveTypes.filter((leaveType) => leaveType.includeInPayroll !== false).length;
  const totalDays = leaveTypes.reduce((sum, leaveType) => sum + (Number(leaveType.daysPerYear) || 0), 0);

  const openEdit = (leaveType: LeaveType) => {
    setIsEdit(true);
    setForm({
      ...leaveType,
      includeInPayroll: leaveType.includeInPayroll !== false,
      maxCarryForward: leaveType.maxCarryForward ?? null
    });
    setOpen(true);
  };

  const openCreate = () => {
    setIsEdit(false);
    setForm(emptyLeaveType);
    setOpen(true);
  };

  const renderStatusBadge = (status: LeaveType["status"]) => (
    <Badge
      variant={status === "active" ? "default" : "secondary"}
      className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${
        status === "active"
          ? "bg-emerald-500 text-white hover:bg-emerald-500"
          : "bg-slate-100 text-slate-600 hover:bg-slate-100"
      }`}
    >
      {status}
    </Badge>
  );

  const renderActions = (leaveType: LeaveType) => (
    <div className="flex items-center gap-2">
      <PermissionGate permissions={["LEAVE_TYPE_MANAGE"]}>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-100 bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100"
          onClick={() => openEdit(leaveType)}
          aria-label={`Edit ${leaveType.name}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
      </PermissionGate>
      <PermissionGate permissions={["LEAVE_TYPE_MANAGE"]}>
        <button
          type="button"
          className={`flex h-9 w-9 items-center justify-center rounded-full border transition ${
            leaveType.status === "inactive"
              ? "cursor-not-allowed border-red-100 bg-red-50 text-red-300"
              : "border-red-100 bg-red-50 text-red-500 hover:bg-red-100"
          }`}
          onClick={() => handleDelete(leaveType._id!)}
          aria-label={`Mark ${leaveType.name} inactive`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </PermissionGate>
    </div>
  );

  return (
    <MainLayout
      title="Leave Types"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Organization" }, { label: "Leave Types" }]}
    >
      {!canView && (
        <div className="rounded-[28px] border border-slate-100 bg-white p-6 text-sm text-slate-500 shadow-sm">
          You do not have permission to view leave types.
        </div>
      )}
      {canView && (
        <div className="space-y-6 rounded-[28px] bg-[#f8f8f6] p-3 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Leave Types</h1>
              <p className="mt-1 text-sm text-slate-500">
                Manage annual leave quotas, carry-forward rules, and payroll payable behavior.
              </p>
            </div>
            <PermissionGate permissions={["LEAVE_TYPE_MANAGE"]}>
              <Button
                onClick={openCreate}
                className="h-11 rounded-2xl bg-emerald-500 px-5 font-semibold text-white shadow-sm hover:bg-emerald-600"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Leave Type
              </Button>
            </PermissionGate>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Total Types</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{leaveTypes.length}</p>
            </div>
            <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Active Types</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-600">{activeCount}</p>
            </div>
            <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Carry Forward</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{carryForwardCount}</p>
            </div>
            <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Annual Days</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{totalDays}</p>
            </div>
          </div>

          <section className="overflow-hidden rounded-[28px] border border-slate-100 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Configured Leave Types</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {payrollPayableCount} payable in payroll, {carryForwardCount} allow carry forward.
                </p>
              </div>
              <div className="relative w-full lg:max-w-sm">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search leave types..."
                  className="h-12 rounded-2xl border-slate-200 bg-slate-50 pl-11"
                />
              </div>
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[920px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-sm text-slate-500">
                    <th className="px-5 py-4 font-medium">Leave Type</th>
                    <th className="px-5 py-4 font-medium">Code</th>
                    <th className="px-5 py-4 font-medium">Days</th>
                    <th className="px-5 py-4 font-medium">Carry Forward</th>
                    <th className="px-5 py-4 font-medium">Payroll Payable</th>
                    <th className="px-5 py-4 font-medium">Status</th>
                    {canManage && <th className="px-5 py-4 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLeaveTypes.map((leaveType) => (
                    <tr key={leaveType._id} className="transition hover:bg-emerald-50/30">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                            <CalendarDays className="h-5 w-5" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-950">{leaveType.name}</p>
                            {leaveType.description && (
                              <p className="mt-0.5 max-w-xs truncate text-sm text-slate-500">{leaveType.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                          {leaveType.code}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-semibold text-slate-900">{leaveType.daysPerYear}</td>
                      <td className="px-5 py-4 text-slate-700">{leaveType.isCarryForward ? "Yes" : "No"}</td>
                      <td className="px-5 py-4 text-slate-700">{leaveType.includeInPayroll === false ? "No" : "Yes"}</td>
                      <td className="px-5 py-4">{renderStatusBadge(leaveType.status)}</td>
                      {canManage && <td className="px-5 py-4">{renderActions(leaveType)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 p-4 lg:hidden">
              {filteredLeaveTypes.map((leaveType) => (
                <article key={leaveType._id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-950">{leaveType.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{leaveType.code}</p>
                    </div>
                    {renderStatusBadge(leaveType.status)}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-slate-500">Days</p>
                      <p className="mt-1 font-semibold text-slate-950">{leaveType.daysPerYear}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-slate-500">Payroll</p>
                      <p className="mt-1 font-semibold text-slate-950">{leaveType.includeInPayroll === false ? "No" : "Yes"}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-slate-500">Carry Forward</p>
                      <p className="mt-1 font-semibold text-slate-950">{leaveType.isCarryForward ? "Yes" : "No"}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3">
                      <p className="text-slate-500">Max Carry</p>
                      <p className="mt-1 font-semibold text-slate-950">{leaveType.maxCarryForward ?? "-"}</p>
                    </div>
                  </div>
                  {canManage && <div className="mt-4">{renderActions(leaveType)}</div>}
                </article>
              ))}
            </div>

            {filteredLeaveTypes.length === 0 && (
              <div className="p-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <Coins className="h-6 w-6" />
                </div>
                <p className="mt-4 font-semibold text-slate-900">No leave types found</p>
                <p className="mt-1 text-sm text-slate-500">Try a different search or add a new leave type.</p>
              </div>
            )}
          </section>
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">{isEdit ? "Edit Leave Type" : "Add Leave Type"}</SheetTitle>
          </SheetHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-6 py-5 lg:grid-cols-2">
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

          <div className="space-y-3 border-t border-slate-100 px-6 py-5">
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

          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {isEdit ? "Update" : "Create"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default LeaveTypes;
