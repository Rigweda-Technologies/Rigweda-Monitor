import { useEffect, useState } from "react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import PermissionGate from "@/components/PermissionGate";
import {
  getApiWithToken,
  postApiWithToken,
  putApiWithToken,
  deleteApiWithToken,
} from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { formatDateInOrgTimeZone } from "@/utils/timezone";

interface HolidayForm {
  _id?: string;
  name: string;
  date: string;
  status: "active" | "inactive";
}

const emptyHoliday: HolidayForm = {
  name: "",
  date: "",
  status: "active",
};

const Holidays = () => {
  const { hasAnyPermission } = useAuth();
  const [holidays, setHolidays] = useState<any[]>([]);
  const [year, setYear] = useState<string>(new Date().getFullYear().toString());
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<HolidayForm>(emptyHoliday);
  const [loading, setLoading] = useState(false);
  const canView = hasAnyPermission(["HOLIDAY_VIEW", "LEAVE_VIEW_SELF", "LEAVE_APPLY"]);
  const canManage = hasAnyPermission(["HOLIDAY_MANAGE"]);

  const fetchHolidays = async () => {
    setLoading(true);
    try {
      const res = await getApiWithToken(`/holidays?year=${year}`, null, {
        requiredPermissions: ["HOLIDAY_VIEW", "LEAVE_VIEW_SELF", "LEAVE_APPLY"]
      });
      if (res?.skipped) {
        setHolidays([]);
        return;
      }
      if (res?.success) {
        setHolidays(res.data || []);
      } else {
        toast.error(res?.message || "Failed to load holidays");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolidays();
  }, [year]);

  const handleSubmit = async () => {
    if (!form.name || !form.date) {
      toast.error("Name and date are required");
      return;
    }
    if (!canManage) {
      toast.error("You do not have permission to manage holidays");
      return;
    }

    let res;
    if (isEdit && form._id) {
      res = await putApiWithToken(`/holidays/${form._id}`, {
        name: form.name,
        date: form.date,
        status: form.status,
      }, null, { requiredPermissions: ["HOLIDAY_MANAGE"] });
    } else {
      res = await postApiWithToken("/holidays", {
        name: form.name,
        date: form.date,
        status: form.status,
      }, null, { requiredPermissions: ["HOLIDAY_MANAGE"] });
    }
    if (res?.skipped) return;

    if (res?.success) {
      toast.success(isEdit ? "Holiday updated" : "Holiday created");
      setOpen(false);
      setForm(emptyHoliday);
      fetchHolidays();
    } else {
      toast.error(res?.message || "Operation failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this holiday?")) return;
    if (!canManage) {
      toast.error("You do not have permission to delete holidays");
      return;
    }

    const res = await deleteApiWithToken(`/holidays/${id}`);
    if (res?.success) {
      toast.success("Holiday deleted");
      fetchHolidays();
    } else {
      toast.error(res?.message || "Delete failed");
    }
  };

  return (
    <MainLayout
      title="Holidays"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Holidays" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view holidays.
        </div>
      )}
      {canView && (
        <>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="Year"
            className="w-28"
          />
          <Button variant="outline" onClick={fetchHolidays} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        <PermissionGate permissions={["HOLIDAY_MANAGE"]}>
          <Button
            onClick={() => {
              setIsEdit(false);
              setForm(emptyHoliday);
              setOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Holiday
          </Button>
        </PermissionGate>
      </div>

      <div className="bg-card rounded-xl card-shadow overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="table-header">
              <TableHead>Name</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              {canManage && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && Array.from({ length: 5 }).map((_, idx) => (
              <TableRow key={`holiday-skeleton-${idx}`}>
                <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-3">
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-4 w-4" />
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!loading && holidays.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-10">
                  No holidays found
                </TableCell>
              </TableRow>
            )}
            {!loading && holidays.map((h) => (
              <TableRow key={h._id}>
                <TableCell>{h.name}</TableCell>
                <TableCell>
                  {h.date ? formatDateInOrgTimeZone(h.date) : "-"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={h.status === "active" ? "default" : "secondary"}
                    className="capitalize"
                  >
                    {h.status}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <PermissionGate permissions={["HOLIDAY_MANAGE"]}>
                    <div className="flex justify-end gap-3">
                      <Pencil
                        className="w-4 h-4 text-blue-600 cursor-pointer hover:scale-110"
                        onClick={() => {
                          setIsEdit(true);
                          setForm({
                            _id: h._id,
                            name: h.name,
                            date: h.date ? h.date.split("T")[0] : "",
                            status: h.status || "active",
                          });
                          setOpen(true);
                        }}
                      />
                      <Trash2
                        className="w-4 h-4 text-red-600 cursor-pointer hover:scale-110"
                        onClick={() => handleDelete(h._id)}
                      />
                    </div>
                    </PermissionGate>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Edit Holiday" : "Add Holiday"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <Input
              placeholder="Holiday Name"
              validationType="name"
              value={form.name}
              onChange={(e) =>
                setForm({ ...form, name: e.target.value })
              }
            />
            <Input
              type="date"
              value={form.date}
              onChange={(e) =>
                setForm({ ...form, date: e.target.value })
              }
            />
            <SelectStatus
              value={form.status}
              onChange={(value) =>
                setForm({ ...form, status: value })
              }
            />
            <Button onClick={handleSubmit} className="w-full">
              {isEdit ? "Update Holiday" : "Create Holiday"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
        </>
      )}
    </MainLayout>
  );
};

const SelectStatus = ({
  value,
  onChange,
}: {
  value: "active" | "inactive";
  onChange: (value: "active" | "inactive") => void;
}) => {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Status</label>
      <select
        className="w-full border rounded-md px-3 py-2 bg-background"
        value={value}
        onChange={(e) => onChange(e.target.value as "active" | "inactive")}
      >
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>
    </div>
  );
};

export default Holidays;
