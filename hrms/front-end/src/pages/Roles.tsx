import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DataTable, Column } from "@/components/ui/DataTable";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import PermissionGate from "@/components/PermissionGate";
import { useAuth } from "@/context/useAuth";
import {
  getApiWithToken,
  postApiWithToken,
  putApiWithToken,
  deleteApiWithToken,
} from "@/services/apiWrapper";

/* ================= TYPES ================= */

interface Role {
  _id?: string;
  name: string;
  slug: string;
  permissionIds: string[];
  isSystemRole: boolean;
  status?: "active" | "inactive";
}

const PROTECTED_ROLE_SLUGS = new Set([
  "org-admin",
  "hr",
  "manager",
  "employee",
]);

const emptyRole: Role = {
  name: "",
  slug: "",
  permissionIds: [],
  isSystemRole: false,
};

/* ================= COMPONENT ================= */

const Roles = () => {
  const { hasAnyPermission } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<Role>(emptyRole);

  /* ================= FETCH ================= */

  const fetchRoles = async () => {
    const res = await getApiWithToken("/roles", null, {
      requiredPermissions: ["ROLE_VIEW"]
    });
    if (res?.skipped) {
      setRoles([]);
      return;
    }

    if (res?.code === 200) {
      setRoles(res.data || []);
    } else {
      toast.error(res?.message || "Failed to load roles");
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  /* ================= DELETE / DEACTIVATE ================= */

  const handleDelete = async (role: Role) => {
    if (role.isSystemRole || PROTECTED_ROLE_SLUGS.has(role.slug)) {
      toast.warning("Default roles cannot be deactivated");
      return;
    }

    const isInactive = role.status === "inactive";
    const confirmMessage = isInactive
      ? "Reactivate this role?"
      : "Deactivate this role? Employees already assigned to it will keep their access.";

    if (!window.confirm(confirmMessage)) return;

    const res = isInactive
      ? await putApiWithToken(`/roles/${role._id}`, { status: "active" })
      : await deleteApiWithToken(`/roles/${role._id}`);

    if (res?.code === 200) {
      toast.success(isInactive ? "Role reactivated" : "Role deactivated");
      fetchRoles();
    } else {
      toast.error(res?.message || (isInactive ? "Reactivate failed" : "Deactivate failed"));
    }
  };

  /* ================= SUBMIT ================= */

  const handleSubmit = async () => {
    if (!form.name || !form.slug) {
      toast.error("Name and slug are required");
      return;
    }

    let res;

    if (isEdit && form._id) {
      res = await putApiWithToken(`/roles/${form._id}`, {
        name: form.name,
        permissionIds: form.permissionIds,
      });
    } else {
      res = await postApiWithToken("/roles", {
        name: form.name,
        slug: form.slug,
      });
    }

    if (res?.success || res?.code === 200 || res?.code === 201) {
      toast.success(isEdit ? "Role updated" : "Role created");
      setOpen(false);
      setForm(emptyRole);
      fetchRoles();
    } else {
      toast.error(res?.message || "Operation failed");
    }
  };

  /* ================= DATATABLE COLUMNS ================= */

  const columns: Column<Role>[] = [
    {
      header: "Name",
      accessor: "name",
      sortable: true,
    },
    {
      header: "Slug",
      accessor: "slug",
      sortable: true,
    },
    {
      header: "Permissions",
      accessor: "permissionIds",
      render: (role) => role.permissionIds.length,
    },
    {
      header: "Type",
      accessor: "isSystemRole",
      render: (role) => (
        <div className="flex items-center gap-2">
          <Badge variant={role.isSystemRole ? "secondary" : "default"}>
            {role.isSystemRole ? "System" : "Custom"}
          </Badge>
          <Badge
            variant={role.status === "inactive" ? "secondary" : "outline"}
            className={role.status === "inactive" ? "text-muted-foreground" : ""}
          >
            {role.status === "inactive" ? "Inactive" : "Active"}
          </Badge>
        </div>
      ),
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (role) => (
        <div className="flex gap-3">
          {!role.isSystemRole && !PROTECTED_ROLE_SLUGS.has(role.slug) && (
            <>
              <PermissionGate permissions={["ROLE_UPDATE"]}>
                <Pencil
                  className="w-4 h-4 text-blue-600 cursor-pointer hover:scale-110"
                  onClick={() => {
                    setIsEdit(true);
                    setForm(role);
                    setOpen(true);
                  }}
                />
              </PermissionGate>
              <PermissionGate permissions={["ROLE_DELETE"]}>
                {role.status === "inactive" ? (
                  <RefreshCw
                    className="w-4 h-4 text-emerald-600 cursor-pointer hover:scale-110"
                    onClick={() => handleDelete(role)}
                  />
                ) : (
                  <Trash2
                    className="w-4 h-4 text-red-600 cursor-pointer hover:scale-110"
                    onClick={() => handleDelete(role)}
                  />
                )}
              </PermissionGate>
            </>
          )}
        </div>
      ),
    },
  ];

  /* ================= UI ================= */

  const canView = hasAnyPermission(["ROLE_VIEW"]);

  return (
    <MainLayout
      title="Roles"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Roles" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view roles.
        </div>
      )}
      {/* Action Bar */}
      {canView && (
        <div className="flex justify-end mb-6">
        <PermissionGate permissions={["ROLE_CREATE"]}>
          <Button
            onClick={() => {
              setIsEdit(false);
              setForm(emptyRole);
              setOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Role
          </Button>
        </PermissionGate>
        </div>
      )}

      {/* DataTable */}
      {canView && (
        <DataTable
        columns={columns}
        data={roles}
        rowKey="_id"
        searchKey="name"
        />
      )}

      {/* Add / Edit Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit Role" : "Add Role"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              placeholder="Role Name"
              validationType="name"
              value={form.name}
              onChange={(e) =>
                setForm({ ...form, name: e.target.value })
              }
            />

            <Input
              placeholder="Slug (eg: hr, manager)"
              validationType="slug"
              value={form.slug}
              disabled={isEdit}
              onChange={(e) =>
                setForm({ ...form, slug: e.target.value })
              }
            />

            <Button onClick={handleSubmit} className="w-full">
              {isEdit ? "Update Role" : "Create Role"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Roles;
