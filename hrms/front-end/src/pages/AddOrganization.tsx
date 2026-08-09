import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/context/useAuth";

const AddOrganization = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { hasAnyPermission } = useAuth();
  const canManage = hasAnyPermission(["ORG_MANAGE"]);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    location: "",
    status: "Active",
  });

  useEffect(() => {
    if (isEdit) {
      setFormData({
        name: "Tech Solutions Ltd",
        email: "info@techsolutions.com",
        phone: "+1 234 567 890",
        location: "New York",
        status: "Active",
      });
    }
  }, [isEdit]);

  const handleChange = (e: any) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: any) => {
    e.preventDefault();
    navigate("/organization");
  };

  return (
    <MainLayout
      title={isEdit ? "Edit Organization" : "Add Organization"}
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Organization", href: "/organization" },
        { label: isEdit ? "Edit" : "Add" },
      ]}
    >
      {!canManage && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to manage organizations.
        </div>
      )}
      {canManage && (
        <div className="bg-card rounded-xl card-shadow p-6 max-w-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            name="name"
            placeholder="Organization Name"
            validationType="name"
            value={formData.name}
            onChange={handleChange}
            required
          />
          <Input
            name="email"
            placeholder="Email"
            validationType="email"
            value={formData.email}
            onChange={handleChange}
            required
          />
          <Input
            name="phone"
            placeholder="Phone"
            validationType="phone"
            value={formData.phone}
            onChange={handleChange}
          />
          <Input
            name="location"
            placeholder="Location"
            value={formData.location}
            onChange={handleChange}
          />

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => navigate("/organization")}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit">
              {isEdit ? "Update Organization" : "Save Organization"}
            </Button>
          </div>
          </form>
        </div>
      )}
    </MainLayout>
  );
};

export default AddOrganization;
