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
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Building2 } from "lucide-react";
import { toast } from "sonner";
import PermissionGate from "@/components/PermissionGate";
import {
  deleteApiWithToken,
  getApiWithToken,
  postApiWithToken,
  putApiWithToken,
} from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";

/* ================= TYPES ================= */

interface Department {
  _id?: string;
  name: string;
  code: string;
  managerId?: string;
  status: "active" | "inactive";
}

const emptyDept: Department = {
  name: "",
  code: "",
  managerId: "",
  status: "active",
};

/* ================= COMPONENT ================= */

const Departments = () => {
  const { hasAnyPermission } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<Department>(emptyDept);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Department["status"]>("all");
  const canView = hasAnyPermission(["DEPT_VIEW"]);
  const canCreate = hasAnyPermission(["DEPT_CREATE"]);
  const canUpdate = hasAnyPermission(["DEPT_UPDATE"]);
  const canDelete = hasAnyPermission(["DEPT_DELETE"]);
  const canAnyAction = canUpdate || canDelete;

  /* ================= FETCH ================= */

  const fetchDepartments = async () => {
    const response = await getApiWithToken("/departments?includeInactive=true", null, {
      requiredPermissions: ["DEPT_VIEW"]
    });
    if (response?.skipped) {
      setDepartments([]);
      return;
    }

    if (response?.success) {
      setDepartments(response.data || []);
    } else {
      toast.error(response?.message || "Failed to load departments");
    }
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  /* ================= DELETE ================= */

  const handleDelete = async (id: string) => {
    const currentDepartment = departments.find((department) => department._id === id);
    if (currentDepartment?.status === "inactive") {
      toast.info("Department is already inactive");
      return;
    }

    if (!window.confirm("Mark this department as inactive?")) return;
    if (!canDelete) {
      toast.error("You do not have permission to delete");
      return;
    }

    const res = await deleteApiWithToken(`/departments/${id}`);

    if (res?.code === 200) {
      toast.success("Department marked as inactive");
      fetchDepartments();
    } else {
      toast.error(res?.message || "Delete failed");
    }
  };

  /* ================= SUBMIT ================= */

  const handleSubmit = async () => {
    const payload = {
      name: form.name,
      managerId: form.managerId?.trim() || "",
      status: form.status,
    };

    let res;

    if (isEdit && form._id) {
      // ❌ Do NOT send code on update
      res = await putApiWithToken(`/departments/${form._id}`, payload, null, {
        requiredPermissions: ["DEPT_UPDATE"]
      });
    } else {
      // ✅ Send code only while creating
      res = await postApiWithToken("/departments", {
        ...payload,
        code: form.code,
      }, null, { requiredPermissions: ["DEPT_CREATE"] });
    }
    if (res?.skipped) return;

    if (res?.success) {
      toast.success(isEdit ? "Department updated" : "Department created");
      setOpen(false);
      setForm(emptyDept);
      fetchDepartments();
    } else {
      toast.error(res?.message || "Operation failed");
    }
  };

  const filteredDepartments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return departments.filter((department) => {
      const matchesSearch =
        !normalizedSearch ||
        department.name?.toLowerCase().includes(normalizedSearch) ||
        department.code?.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" || department.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [departments, search, statusFilter]);

  const activeCount = departments.filter((department) => department.status === "active").length;
  const inactiveCount = departments.length - activeCount;

  /* ================= DATATABLE COLUMNS ================= */

  const columns: Column<Department>[] = [
    {
      header: "Name",
      accessor: "name",
      sortable: true,
      render: (dept) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-foreground">{dept.name}</p>
            <p className="text-xs text-muted-foreground">Code: {dept.code || "-"}</p>
          </div>
        </div>
      ),
    },
    {
      header: "Code",
      accessor: "code",
      sortable: true,
      render: (dept) => (
        <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs uppercase tracking-wide">
          {dept.code || "-"}
        </span>
      ),
    },
    {
      header: "Status",
      accessor: "status",
      render: (dept) => (
        <Badge
          variant={dept.status === "active" ? "default" : "secondary"}
          className="capitalize"
        >
          {dept.status}
        </Badge>
      ),
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (dept) => (
        <div className="flex gap-3">
          <PermissionGate permissions={["DEPT_UPDATE"]}>
            <Pencil
              className="w-4 h-4 text-emerald-600 cursor-pointer hover:scale-110"
              onClick={() => {
                setIsEdit(true);
                setForm(dept);
                setOpen(true);
              }}
            />
          </PermissionGate>
          <PermissionGate permissions={["DEPT_DELETE"]}>
            <Trash2
              className={`w-4 h-4 ${
                dept.status === "inactive"
                  ? "text-red-300 cursor-not-allowed"
                  : "text-red-600 cursor-pointer hover:scale-110"
              }`}
              onClick={() => handleDelete(dept._id!)}
            />
          </PermissionGate>
        </div>
      ),
    },
  ];

  /* ================= UI ================= */

  return (
    <MainLayout
      title="Departments"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Departments" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view departments.
        </div>
      )}
      {canView && (
        <>
          <div className="mb-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 card-shadow">
              <p className="text-sm text-muted-foreground">Total Departments</p>
              <p className="mt-2 text-2xl font-semibold">{departments.length}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 card-shadow">
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{activeCount}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 card-shadow">
              <p className="text-sm text-muted-foreground">Inactive</p>
              <p className="mt-2 text-2xl font-semibold text-muted-foreground">{inactiveCount}</p>
            </div>
          </div>

          <div className="mb-6 flex flex-col gap-3 rounded-xl border bg-card p-4 card-shadow lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 flex-col gap-3 sm:flex-row">
              <Input
                placeholder="Search by name or code"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:max-w-sm"
              />
              <Select
                value={statusFilter}
                onValueChange={(value: "all" | Department["status"]) => setStatusFilter(value)}
              >
                <SelectTrigger className="sm:w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <PermissionGate permissions={["DEPT_CREATE"]}>
              <Button
                onClick={() => {
                  setIsEdit(false);
                  setForm(emptyDept);
                  setOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Department
              </Button>
            </PermissionGate>
          </div>

          <DataTable
            columns={canAnyAction ? columns : columns.filter((c) => c.header !== "Actions")}
            data={filteredDepartments}
            rowKey="_id"
            searchKey={undefined}
          />
        </>
      )}

      {/* Add / Edit Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit Department" : "Add Department"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              placeholder="Department Name"
              validationType="name"
              value={form.name}
              onChange={(e) =>
                setForm({ ...form, name: e.target.value })
              }
            />

            {!isEdit && (
              <Input
                placeholder="Department Code"
                value={form.code}
                onChange={(e) =>
                  setForm({ ...form, code: e.target.value.toUpperCase() })
                }
                autoComplete="off"
                spellCheck={false}
              />
            )}

            <Input
              placeholder="Manager ID (optional)"
              value={form.managerId}
              onChange={(e) =>
                setForm({ ...form, managerId: e.target.value })
              }
            />

            <Select
              value={form.status}
              onValueChange={(v: "active" | "inactive") =>
                setForm({ ...form, status: v })
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

            <Button onClick={handleSubmit} className="w-full">
              {isEdit ? "Update Department" : "Create Department"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Departments;
