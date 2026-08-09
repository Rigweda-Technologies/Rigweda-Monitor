import { useEffect, useMemo, useState } from "react";
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

type ModuleKey = "leave" | "attendance_request";
type ApproverType = "manager" | "role" | "employee";

interface RoleOption {
  _id: string;
  name: string;
  slug: string;
}

interface EmployeeOption {
  _id: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
}

interface FlowStep {
  stepNumber: number;
  approverType: ApproverType;
  roleSlug?: string | null;
  employeeId?: string | null;
}

interface ApprovalFlow {
  _id?: string;
  moduleKey: ModuleKey;
  name: string;
  isActive: boolean;
  minDays?: number | null;
  maxDays?: number | null;
  steps: FlowStep[];
}

interface StepFormRow {
  id: string;
  stepNumber: number;
  approverType: ApproverType;
  roleSlug: string;
  employeeId: string;
}

const emptyForm: ApprovalFlow = {
  moduleKey: "leave",
  name: "",
  isActive: true,
  minDays: null,
  maxDays: null,
  steps: []
};

const createStepRow = (stepNumber: number): StepFormRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  stepNumber,
  approverType: "manager",
  roleSlug: "",
  employeeId: ""
});

const moduleLabel = (moduleKey: ModuleKey) =>
  moduleKey === "leave" ? "Leave" : "Attendance Request";

const rangeLabel = (flow: ApprovalFlow) => {
  if (flow.minDays == null && flow.maxDays == null) return "Default";
  return `${flow.minDays ?? 0} - ${flow.maxDays ?? "Any"}`;
};

const approverLabel = (step: FlowStep) => {
  if (step.approverType === "manager") return "Reporting Manager";
  if (step.approverType === "role") return `Role: ${step.roleSlug || "-"}`;
  return `Employee: ${step.employeeId || "-"}`;
};

const sanitizeFlowName = (value: string) => value.replace(/[^A-Za-z ]+/g, "").replace(/\s{2,}/g, " ");

const ApprovalFlows = () => {
  const { hasAnyPermission } = useAuth();
  const [flows, setFlows] = useState<ApprovalFlow[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ApprovalFlow>(emptyForm);
  const [stepRows, setStepRows] = useState<StepFormRow[]>([createStepRow(1)]);
  const [loading, setLoading] = useState(false);
  const canView = hasAnyPermission(["APPROVAL_FLOW_VIEW"]);
  const canManage = hasAnyPermission(["APPROVAL_FLOW_MANAGE"]);

  const employeeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((emp) => {
      const fullName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.employeeCode || "Employee";
      map.set(emp._id, emp.employeeCode ? `${fullName} (${emp.employeeCode})` : fullName);
    });
    return map;
  }, [employees]);

  const fetchFlows = async () => {
    const res = await getApiWithToken("/approval-flows", null, {
      requiredPermissions: ["APPROVAL_FLOW_VIEW"]
    });
    if (res?.skipped) {
      setFlows([]);
      return;
    }
    if (res?.success || res?.code === 200) {
      setFlows(res.data || []);
    } else {
      toast.error(res?.message || "Failed to load approval flows");
    }
  };

  const fetchRoles = async () => {
    const res = await getApiWithToken("/roles", null, {
      requiredPermissions: ["ROLE_VIEW"]
    });
    if (res?.success || res?.code === 200) {
      setRoles((res.data || []).map((role: any) => ({
        _id: role._id,
        name: role.name,
        slug: role.slug
      })));
    } else {
      setRoles([]);
    }
  };

  const fetchEmployees = async () => {
    const res = await getApiWithToken("/employees", null, {
      requiredPermissions: ["EMP_VIEW"]
    });
    if (res?.success) {
      setEmployees(res.data?.items || []);
    } else {
      setEmployees([]);
    }
  };

  useEffect(() => {
    if (!canView) return;
    fetchFlows();
    fetchRoles();
    fetchEmployees();
  }, [canView]);

  const openCreate = () => {
    setIsEdit(false);
    setEditingId(null);
    setForm(emptyForm);
    setStepRows([createStepRow(1)]);
    setOpen(true);
  };

  const openEdit = (flow: ApprovalFlow) => {
    setIsEdit(true);
    setEditingId(flow._id || null);
    setForm({
      moduleKey: flow.moduleKey,
      name: flow.name,
      isActive: flow.isActive,
      minDays: flow.minDays ?? null,
      maxDays: flow.maxDays ?? null,
      steps: flow.steps || []
    });
    setStepRows(
      (flow.steps || []).map((step, index) => ({
        id: `${Date.now()}-${index}`,
        stepNumber: Number(step.stepNumber || index + 1),
        approverType: step.approverType,
        roleSlug: step.roleSlug || "",
        employeeId:
          typeof step.employeeId === "string"
            ? step.employeeId
            : (step.employeeId as any)?._id || ""
      }))
    );
    setOpen(true);
  };

  const handleDelete = async (id: string) => {
    const currentFlow = flows.find((flow) => flow._id === id);
    if (currentFlow && !currentFlow.isActive) {
      toast.info("Approval flow is already inactive");
      return;
    }

    if (!window.confirm("Mark this approval flow as inactive?")) return;
    const res = await deleteApiWithToken(`/approval-flows/${id}`);
    if (res?.success || res?.code === 200) {
      toast.success("Approval flow marked as inactive");
      fetchFlows();
    } else {
      toast.error(res?.message || "Delete failed");
    }
  };

  const addStep = () => {
    const nextStepNumber = Math.max(0, ...stepRows.map((s) => Number(s.stepNumber || 0))) + 1;
    setStepRows((prev) => [...prev, createStepRow(nextStepNumber)]);
  };

  const removeStep = (id: string) => {
    setStepRows((prev) => prev.filter((row) => row.id !== id));
  };

  const updateStep = (id: string, patch: Partial<StepFormRow>) => {
    setStepRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.approverType && patch.approverType !== row.approverType) {
          next.roleSlug = "";
          next.employeeId = "";
        }
        return next;
      })
    );
  };

  const handleSubmit = async () => {
    if (!canManage) {
      toast.error("You do not have permission to manage approval flows");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Flow name is required");
      return;
    }
    if (!/^[A-Za-z ]+$/.test(form.name.trim())) {
      toast.error("Flow name can contain only letters and spaces");
      return;
    }
    if (!stepRows.length) {
      toast.error("Add at least one approval step");
      return;
    }
    if (form.minDays === null || form.minDays === undefined) {
      toast.error("Min days is required");
      return;
    }

    const normalizedSteps = [...stepRows]
      .map((row) => ({
        stepNumber: Number(row.stepNumber || 0),
        approverType: row.approverType,
        roleSlug: row.roleSlug || undefined,
        employeeId: row.employeeId || undefined
      }))
      .sort((a, b) => a.stepNumber - b.stepNumber);

    const usedStepNumbers = new Set<number>();
    for (const step of normalizedSteps) {
      if (!step.stepNumber || step.stepNumber < 1) {
        toast.error("Step number must be 1 or greater");
        return;
      }
      if (usedStepNumbers.has(step.stepNumber)) {
        toast.error("Step numbers must be unique");
        return;
      }
      usedStepNumbers.add(step.stepNumber);
      if (step.approverType === "role" && !step.roleSlug) {
        toast.error(`Role is required for step ${step.stepNumber}`);
        return;
      }
      if (step.approverType === "employee" && !step.employeeId) {
        toast.error(`Employee is required for step ${step.stepNumber}`);
        return;
      }
    }

    const payload = {
      moduleKey: form.moduleKey,
      name: form.name.trim(),
      isActive: Boolean(form.isActive),
      minDays: form.minDays === null || form.minDays === undefined
        ? null
        : Number(form.minDays),
      maxDays: form.maxDays === null || form.maxDays === undefined
        ? null
        : Number(form.maxDays),
      steps: normalizedSteps
    };

    if (payload.minDays !== null && payload.maxDays !== null && payload.minDays > payload.maxDays) {
      toast.error("Min days cannot be greater than max days");
      return;
    }

    try {
      setLoading(true);
      let res;
      if (isEdit && editingId) {
        res = await putApiWithToken(`/approval-flows/${editingId}`, payload, null, {
          requiredPermissions: ["APPROVAL_FLOW_MANAGE"]
        });
      } else {
        res = await postApiWithToken("/approval-flows", payload, null, {
          requiredPermissions: ["APPROVAL_FLOW_MANAGE"]
        });
      }
      if (res?.skipped) return;
      if (res?.success || res?.code === 200 || res?.code === 201) {
        toast.success(isEdit ? "Approval flow updated" : "Approval flow created");
        setOpen(false);
        fetchFlows();
      } else {
        toast.error(res?.message || "Operation failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const columns: Column<ApprovalFlow>[] = [
    {
      header: "Name",
      accessor: "name",
      sortable: true
    },
    {
      header: "Module",
      accessor: "moduleKey",
      render: (row) => moduleLabel(row.moduleKey)
    },
    {
      header: "Range (Days)",
      accessor: "minDays",
      render: (row) => rangeLabel(row)
    },
    {
      header: "Steps",
      accessor: "steps",
      render: (row) => (
        <div className="text-xs text-muted-foreground">
          {(row.steps || [])
            .sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber))
            .map((step) => {
              const label =
                step.approverType === "employee" && step.employeeId
                  ? `Employee: ${employeeNameMap.get(String((step.employeeId as any)?._id || step.employeeId)) || "Assigned"}`
                  : approverLabel(step);
              return (
                <div key={`${row._id}-${step.stepNumber}`}>
                  {`S${step.stepNumber}: ${label}`}
                </div>
              );
            })}
        </div>
      )
    },
    {
      header: "Status",
      accessor: "isActive",
      render: (row) => (
        <Badge variant={row.isActive ? "default" : "secondary"}>
          {row.isActive ? "Active" : "Inactive"}
        </Badge>
      )
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (row) => (
        <div className="flex gap-3">
          <PermissionGate permissions={["APPROVAL_FLOW_MANAGE"]}>
            <Pencil
              className="w-4 h-4 text-blue-600 cursor-pointer hover:scale-110"
              onClick={() => openEdit(row)}
            />
          </PermissionGate>
          <PermissionGate permissions={["APPROVAL_FLOW_MANAGE"]}>
            <Trash2
              className={`w-4 h-4 ${
                row.isActive
                  ? "text-red-600 cursor-pointer hover:scale-110"
                  : "text-red-300 cursor-not-allowed"
              }`}
              onClick={() => handleDelete(row._id!)}
            />
          </PermissionGate>
        </div>
      )
    }
  ];

  return (
    <MainLayout
      title="Approval Flows"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Organization" }, { label: "Approval Flows" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view approval flows.
        </div>
      )}

      {canView && (
        <>
          <div className="flex justify-end mb-6">
            <PermissionGate permissions={["APPROVAL_FLOW_MANAGE"]}>
              <Button onClick={openCreate}>
                <Plus className="w-4 h-4 mr-2" />
                Add Approval Flow
              </Button>
            </PermissionGate>
          </div>

          <DataTable
            columns={canManage ? columns : columns.filter((c) => c.header !== "Actions")}
            data={flows}
            rowKey="_id"
            searchKey="name"
          />
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Approval Flow" : "Add Approval Flow"}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <Input
              placeholder="Flow name"
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: sanitizeFlowName(e.target.value) }))
              }
            />

            <Select
              value={form.moduleKey}
              onValueChange={(value) => setForm((prev) => ({ ...prev, moduleKey: value as ModuleKey }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="leave">Leave</SelectItem>
                <SelectItem value="attendance_request">Attendance Request</SelectItem>
              </SelectContent>
            </Select>

            <Input
              type="number"
              min={0}
              required
              placeholder="Min days *"
              value={form.minDays ?? ""}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  minDays: e.target.value === "" ? null : Number(e.target.value)
                }))
              }
            />

            <Input
              type="number"
              min={0}
              placeholder="Max days (optional)"
              value={form.maxDays ?? ""}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  maxDays: e.target.value === "" ? null : Number(e.target.value)
                }))
              }
            />

            <div className="md:col-span-2">
              <Select
                value={form.isActive ? "active" : "inactive"}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, isActive: value === "active" }))
                }
              >
                <SelectTrigger className="w-full md:w-64">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Approval Steps</h4>
              <Button type="button" variant="outline" onClick={addStep}>
                <Plus className="w-4 h-4 mr-2" />
                Add Step
              </Button>
            </div>

            {stepRows.map((row) => (
              <div key={row.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 border rounded-md">
                <Input
                  type="number"
                  min={1}
                  value={row.stepNumber}
                  onChange={(e) =>
                    updateStep(row.id, {
                      stepNumber: Number(e.target.value || 0)
                    })
                  }
                  className="md:col-span-2"
                  placeholder="Step #"
                />

                <div className="md:col-span-3">
                  <Select
                    value={row.approverType}
                    onValueChange={(value) =>
                      updateStep(row.id, {
                        approverType: value as ApproverType
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Approver type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="role">Role</SelectItem>
                      <SelectItem value="employee">Employee</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {row.approverType === "role" && (
                  <div className="md:col-span-5">
                    <Select
                      value={row.roleSlug}
                      onValueChange={(value) => updateStep(row.id, { roleSlug: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role._id} value={role.slug}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {row.approverType === "employee" && (
                  <div className="md:col-span-5">
                    <Select
                      value={row.employeeId}
                      onValueChange={(value) => updateStep(row.id, { employeeId: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select employee" />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map((emp) => {
                          const label = employeeNameMap.get(emp._id) || "Employee";
                          return (
                            <SelectItem key={emp._id} value={emp._id}>
                              {label}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {row.approverType === "manager" && (
                  <div className="md:col-span-5 flex items-center text-sm text-muted-foreground">
                    Requester&apos;s reporting manager
                  </div>
                )}

                <div className="md:col-span-2 flex items-center justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => removeStep(row.id)}
                    disabled={stepRows.length <= 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 mt-6">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {isEdit ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default ApprovalFlows;
