import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Info } from "lucide-react";
import { getApiWithToken, postApiWithToken, putApiWithToken, deleteApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { useAuth } from "@/context/useAuth";
import PermissionGate from "@/components/PermissionGate";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Shift = {
  _id?: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  status: "active" | "inactive";
};

const emptyShift: Shift = {
  name: "",
  code: "",
  startTime: "09:00",
  endTime: "18:00",
  graceMinutes: 0,
  status: "active"
};

const Shifts = () => {
  const { hasAnyPermission } = useAuth();
  const canView = hasAnyPermission(["SHIFT_VIEW"]);
  const canManage = hasAnyPermission(["SHIFT_MANAGE"]);
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<Shift>(emptyShift);
  const [rows, setRows] = useState<Shift[]>([]);

  const load = async () => {
    const res = await getApiWithToken("/shifts", null, { requiredPermissions: ["SHIFT_VIEW"] });
    if (res?.skipped) return;
    if (res?.success) setRows(res.data || []);
    else toast.error(res?.message || "Failed to load shifts");
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async () => {
    const payload = {
      name: form.name,
      code: form.code.toUpperCase(),
      startTime: form.startTime,
      endTime: form.endTime,
      graceMinutes: Number(form.graceMinutes || 0),
      status: form.status
    };
    const res = isEdit && form._id
      ? await putApiWithToken(`/shifts/${form._id}`, payload, null, { requiredPermissions: ["SHIFT_MANAGE"] })
      : await postApiWithToken("/shifts", payload, null, { requiredPermissions: ["SHIFT_MANAGE"] });

    if (res?.skipped) return;
    if (!res?.success) {
      toast.error(res?.message || "Failed to save shift");
      return;
    }
    toast.success(isEdit ? "Shift updated" : "Shift created");
    setOpen(false);
    setForm(emptyShift);
    load();
  };

  const remove = async (id: string) => {
    const currentShift = rows.find((row) => row._id === id);
    if (currentShift?.status === "inactive") {
      toast.info("Shift is already inactive");
      return;
    }

    if (!window.confirm("Deactivate this shift?")) return;
    const res = await deleteApiWithToken(`/shifts/${id}`);
    if (res?.success) {
      toast.success("Shift deactivated");
      load();
    } else {
      toast.error(res?.message || "Failed to deactivate shift");
    }
  };

  const columns: Column<Shift>[] = [
    { header: "Name", accessor: "name", sortable: true },
    { header: "Code", accessor: "code", sortable: true },
    { header: "Start", accessor: "startTime" },
    { header: "End", accessor: "endTime" },
    { header: "Grace (min)", accessor: "graceMinutes" },
    {
      header: "Status",
      accessor: "status",
      render: (r) => (
        <Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge>
      )
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (r) => (
        <div className="flex gap-3">
          <PermissionGate permissions={["SHIFT_MANAGE"]}>
            <Pencil
              className="w-4 h-4 text-blue-600 cursor-pointer"
              onClick={() => {
                setIsEdit(true);
                setForm({
                  _id: r._id,
                  name: r.name,
                  code: r.code,
                  startTime: r.startTime,
                  endTime: r.endTime,
                  graceMinutes: Number(r.graceMinutes || 0),
                  status: r.status
                });
                setOpen(true);
              }}
            />
          </PermissionGate>
          <PermissionGate permissions={["SHIFT_MANAGE"]}>
            <Trash2
              className={`w-4 h-4 ${
                r.status === "inactive"
                  ? "text-red-300 cursor-not-allowed"
                  : "text-red-600 cursor-pointer"
              }`}
              onClick={() => remove(r._id!)}
            />
          </PermissionGate>
        </div>
      )
    }
  ];

  return (
    <MainLayout title="Shifts" breadcrumb={[{ label: "Home", href: "/" }, { label: "Organization" }, { label: "Shifts" }]}>
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view shifts.
        </div>
      )}
      {canView && (
        <>
          <div className="bg-card rounded-xl card-shadow p-4 mb-4 text-sm text-muted-foreground">
            Configure day/night/custom shifts. Hover info icons to understand each field.
          </div>
          <div className="flex justify-end mb-6">
            <PermissionGate permissions={["SHIFT_MANAGE"]}>
              <Button
                onClick={() => {
                  setIsEdit(false);
                  setForm(emptyShift);
                  setOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Shift
              </Button>
            </PermissionGate>
          </div>

          <DataTable
            columns={canManage ? columns : columns.filter((c) => c.header !== "Actions")}
            data={rows}
            rowKey="_id"
            searchKey="name"
          />
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Shift" : "Add Shift"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1 mb-1 text-sm">
                <span>Shift Name</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>User-facing shift label. Example: Day Shift, Night Shift.</TooltipContent>
                </Tooltip>
              </div>
              <Input
                placeholder="Shift name"
                validationType="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1 text-sm">
                <span>Code</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>Unique short code used in reports and attendance details.</TooltipContent>
                </Tooltip>
              </div>
              <Input
                placeholder="Code"
                validationType="code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                disabled={isEdit}
              />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1 text-sm">
                <span>Start Time</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>Scheduled login time for this shift.</TooltipContent>
                </Tooltip>
              </div>
              <Input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1 text-sm">
                <span>End Time</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>If end time is earlier than start, system treats it as overnight shift.</TooltipContent>
                </Tooltip>
              </div>
              <Input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1 text-sm">
                <span>Grace Minutes</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>Allowed delay after shift start. Late count starts after this window.</TooltipContent>
                </Tooltip>
              </div>
              <Input
                type="number"
                min={0}
                max={180}
                placeholder="Grace minutes"
                value={form.graceMinutes}
                onChange={(e) => setForm({ ...form, graceMinutes: Number(e.target.value || 0) })}
              />
            </div>
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as "active" | "inactive" })}
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

          <div className="flex justify-end gap-2 mt-5">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit}>{isEdit ? "Update" : "Create"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Shifts;
