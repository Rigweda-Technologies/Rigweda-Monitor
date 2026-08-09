import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useNavigate, useParams } from "react-router-dom";

const modules = [
  "Dashboard",
  "Employees",
  "Attendance",
  "Leave",
  "Payroll",
  "Performance",
  "Reports",
  "Organization",
  "Settings",
];

const AddRole = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [roleName, setRoleName] = useState("");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);

  const togglePermission = (module: string) => {
    if (permissions.includes(module)) {
      setPermissions(permissions.filter((p) => p !== module));
    } else {
      setPermissions([...permissions, module]);
    }
  };

  const handleSubmit = (e: any) => {
    e.preventDefault();
    navigate("/roles");
  };

  return (
    <MainLayout
      title={isEdit ? "Edit Role" : "Add Role"}
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Roles", href: "/roles" },
        { label: isEdit ? "Edit" : "Add" },
      ]}
    >
      <div className="bg-card rounded-xl card-shadow p-4 sm:p-6 max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Role Info */}
          <div>
            <label className="block mb-2 font-medium">Role Name</label>
            <Input
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder="Enter role name"
              required
            />
          </div>

          <div>
            <label className="block mb-2 font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description"
            />
          </div>

          {/* Permission Matrix */}
          <div>
            <h3 className="font-semibold mb-3">Permissions</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {modules.map((module) => (
                <div key={module} className="flex items-center gap-3">
                  <Checkbox
                    checked={permissions.includes(module)}
                    onCheckedChange={() => togglePermission(module)}
                  />
                  <span>{module}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate("/roles")}
            >
              Cancel
            </Button>
            <Button type="submit">
              {isEdit ? "Update Role" : "Create Role"}
            </Button>
          </div>

        </form>
      </div>
    </MainLayout>
  );
};

export default AddRole;
