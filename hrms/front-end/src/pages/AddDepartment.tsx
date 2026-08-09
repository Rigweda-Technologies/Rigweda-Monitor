import { useState, useEffect, type FormEvent } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getApiWithToken, postApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { toast } from "sonner";


const AddDepartment = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { hasAnyPermission } = useAuth();
  const canCreate = hasAnyPermission(["DEPT_CREATE"]);
  const canUpdate = hasAnyPermission(["DEPT_UPDATE"]);

  const [formData, setFormData] = useState({
    name: "",
    code: "",
    managerId: "",
    status: "active",
  });

  // 🔹 GET Department by ID (for edit)
      const { data } = useQuery({
      queryKey: ["department", id],
      queryFn: async () => {
        const res = await getApiWithToken(`/departments/${id}`, null, {
          requiredPermissions: ["DEPT_VIEW"]
        });
        return res.data;
      },
      enabled: !!id && canUpdate,
    });


  // Populate form when editing
  useEffect(() => {
    if (data) {
      setFormData({
        name: data.name,
        code: data.code,
        managerId: data.managerId,
        status: data.status,
      });
    }
  }, [data]);

  // 🔹 Create / Update Mutation
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const payload = {
      ...formData,
      managerId: formData.managerId?.trim() || "",
    };

    const res = isEdit
      ? await putApiWithToken(`/departments/${id}`, payload, null, {
          requiredPermissions: ["DEPT_UPDATE"]
        })
      : await postApiWithToken(`/departments`, payload, null, {
          requiredPermissions: ["DEPT_CREATE"]
        });

    setIsSubmitting(false);

    if (res?.skipped) return;

    if (res?.success) {
      toast.success(isEdit ? "Department updated" : "Department created");
      navigate("/departments");
      return;
    }

    toast.error(res?.message || "Failed to save department");
  };

  return (
    <MainLayout
      title={isEdit ? "Edit Department" : "Add Department"}
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Departments", href: "/departments" },
        { label: isEdit ? "Edit" : "Add" },
      ]}
    >
      {!isEdit && !canCreate && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to create departments.
        </div>
      )}
      {isEdit && !canUpdate && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to update departments.
        </div>
      )}
      {((!isEdit && canCreate) || (isEdit && canUpdate)) && (
      <div className="bg-white rounded-xl shadow-sm p-6 max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-5">

          <Input
            placeholder="Department Name"
            validationType="name"
            value={formData.name}
            onChange={(e) =>
              setFormData({ ...formData, name: e.target.value })
            }
            required
          />

          <Input
            type="text"
            placeholder="Department Code (HR, IT)"
            autoComplete="off"
            spellCheck={false}
            value={formData.code}
            onChange={(e) =>
              setFormData({ ...formData, code: e.target.value })
            }
            required
          />

          <Input
            placeholder="Manager ID"
            value={formData.managerId}
            onChange={(e) =>
              setFormData({ ...formData, managerId: e.target.value })
            }
          />

          {/* Status Dropdown */}
          <Select
            value={formData.status}
            onValueChange={(value) =>
              setFormData({ ...formData, status: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/departments")}
            >
              Cancel
            </Button>

            <Button type="submit" disabled={isSubmitting}>
              {isEdit ? "Update Department" : "Create Department"}
            </Button>
          </div>

        </form>
      </div>
      )}
    </MainLayout>
  );
};

export default AddDepartment;
