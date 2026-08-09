import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import PermissionGate from "@/components/PermissionGate";
import {
  getApiWithToken,
  postApiWithToken,
  putApiWithToken,
  deleteApiWithToken,
} from "@/services/apiWrapper";
import { DataTable, Column } from "@/components/ui/DataTable";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/useAuth";

/* ================= TYPES ================= */

interface Designation {
  _id?: string;
  name: string;
  departmentId: string;
  status: "active" | "inactive";
}

const emptyDesignation: Designation = {
  name: "",
  departmentId: "",
  status: "active",
};

/* ================= COMPONENT ================= */

const Designations = () => {
  const { hasAnyPermission } = useAuth();
  const [designations, setDesignations] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<Designation>(emptyDesignation);
  const canView = hasAnyPermission(["DESIG_VIEW"]);
  const canCreate = hasAnyPermission(["DESIG_CREATE"]);
  const canUpdate = hasAnyPermission(["DESIG_UPDATE"]);
  const canDelete = hasAnyPermission(["DESIG_DELETE"]);
  const canAnyAction = canUpdate || canDelete;

  /* ================= FETCH ================= */

  const fetchDesignations = async () => {
    const res = await getApiWithToken("/designations?includeInactive=true", null, {
      requiredPermissions: ["DESIG_VIEW"]
    });
    if (res?.skipped) {
      setDesignations([]);
      return;
    }
    if (res?.success) {
      setDesignations(res.data || []);
    } else {
      toast.error(res?.message || "Failed to load designations");
    }
  };

  const fetchDepartments = async () => {
    const res = await getApiWithToken("/departments", null, {
      requiredPermissions: ["DEPT_VIEW"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      setDepartments(res.data || []);
    } else {
      toast.error("Failed to load departments");
    }
  };


  useEffect(() => {
    fetchDesignations();
    fetchDepartments();
  }, []);

  /* ================= DELETE ================= */

  const handleDelete = async (id: string) => {
    const currentDesignation = designations.find((designation) => designation._id === id);
    if (currentDesignation?.status === "inactive") {
      toast.info("Designation is already inactive");
      return;
    }

    if (!window.confirm("Mark this designation as inactive?")) return;
    if (!canDelete) {
      toast.error("You do not have permission to delete");
      return;
    }

    const res = await deleteApiWithToken(`/designations/${id}`);
    if (res?.success) {
      toast.success("Designation marked as inactive");
      fetchDesignations();
    } else {
      toast.error(res?.message || "Delete failed");
    }
  };

  /* ================= SUBMIT ================= */

  const handleSubmit = async () => {
    const payload = {
      name: form.name,
      departmentId: form.departmentId,
      status: form.status,
    };

    let res;

    if (isEdit && form._id) {
      res = await putApiWithToken(`/designations/${form._id}`, payload, null, {
        requiredPermissions: ["DESIG_UPDATE"]
      });
    } else {
      res = await postApiWithToken("/designations", payload, null, {
        requiredPermissions: ["DESIG_CREATE"]
      });
    }
    if (res?.skipped) return;

    if (res?.success) {
      toast.success(isEdit ? "Designation updated" : "Designation created");
      setOpen(false);
      setForm(emptyDesignation);
      fetchDesignations();
    } else {
      toast.error(res?.message || "Operation failed");
    }
  };

  const filteredDesignations = useMemo(() => {
    if (!search) return designations;
    return designations.filter((d) => {
      const name = (d.name || "").toLowerCase();
      const dept = (d.departmentName || "").toLowerCase();
      return (
        name.includes(search.toLowerCase()) ||
        dept.includes(search.toLowerCase())
      );
    });
  }, [designations, search]);

  const columns: Column<any>[] = [
    {
      header: "Designation",
      accessor: "name",
      sortable: true
    },
    {
      header: "Department",
      accessor: "departmentName",
      render: (des) => des.departmentName || "-",
      sortable: true
    },
    {
      header: "Status",
      accessor: "status",
      render: (des) => (
        <Badge variant={des.status === "active" ? "default" : "secondary"}>
          {des.status}
        </Badge>
      )
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (des) => (
        <div className="flex gap-3">
          <PermissionGate permissions={["DESIG_UPDATE"]}>
            <Pencil
              className="w-4 h-4 cursor-pointer text-blue-500 hover:text-blue-700"
              onClick={() => {
                setIsEdit(true);
                setForm(des);
                setOpen(true);
              }}
            />
          </PermissionGate>
          <PermissionGate permissions={["DESIG_DELETE"]}>
            <Trash2
              className={`w-4 h-4 ${
                des.status === "inactive"
                  ? "text-red-300 cursor-not-allowed"
                  : "cursor-pointer text-red-500 hover:text-red-700"
              }`}
              onClick={() => handleDelete(des._id)}
            />
          </PermissionGate>
        </div>
      )
    }
  ];

  /* ================= UI ================= */

  return (
    <MainLayout
      title="Designations"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Designations" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view designations.
        </div>
      )}
      {/* ---------- Action Bar ---------- */}
      {canView && (
        <>
          <div className="flex justify-between items-center mb-6">
            <div className="relative w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search designation..."
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <PermissionGate permissions={["DESIG_CREATE"]}>
              <Button
                onClick={() => {
                  setIsEdit(false);
                  setForm(emptyDesignation);
                  setOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Designation
              </Button>
            </PermissionGate>
          </div>

          {/* ---------- Table ---------- */}
          <DataTable
            columns={canAnyAction ? columns : columns.filter((c) => c.header !== "Actions")}
            data={filteredDesignations}
            rowKey="_id"
            searchKey="name"
          />

          {/* ---------- Modal ---------- */}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {isEdit ? "Edit Designation" : "Add Designation"}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <Input
                  placeholder="Designation Name"
                  validationType="designationName"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                />

                {/* Department Dropdown */}
                <Select
                  value={form.departmentId}
                  onValueChange={(v) =>
                    setForm({ ...form, departmentId: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d._id} value={d._id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Status */}
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
                  {isEdit ? "Update Designation" : "Create Designation"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </MainLayout>
  );
};

export default Designations;
