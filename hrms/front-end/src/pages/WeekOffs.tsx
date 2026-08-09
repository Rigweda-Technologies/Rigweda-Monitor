import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getApiWithToken, postApiWithToken } from "@/services/apiWrapper";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/context/useAuth";
import PermissionGate from "@/components/PermissionGate";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

const DAYS = [
  { label: "Sunday", value: 0 },
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
];

const WeekOffs = () => {
  const [weekOffDays, setWeekOffDays] = useState<number[]>([]);
  const [configs, setConfigs] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>("default");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { hasAnyPermission } = useAuth();
  const canView = hasAnyPermission(["WEEK_OFF_VIEW"]);
  const canManage = hasAnyPermission(["WEEK_OFF_MANAGE"]);

  const fetchConfigs = async () => {
    const res = await getApiWithToken("/week-offs/all", null, {
      requiredPermissions: ["WEEK_OFF_VIEW"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      const allConfigs = res?.data || [];
      setConfigs(allConfigs);
    } else {
      toast.error(res?.message || "Failed to load week off config");
    }
  };

  const fetchShifts = async () => {
    const res = await getApiWithToken("/shifts", null, {
      requiredPermissions: ["SHIFT_VIEW", "WEEK_OFF_VIEW"]
    });
    if (res?.success) {
      setShifts((res?.data || []).filter((s: any) => s.status === "active"));
    }
  };

  const fetchConfigForSelection = async (shiftId: string) => {
    const params =
      shiftId === "default"
        ? ""
        : `?shiftId=${encodeURIComponent(shiftId)}`;
    const res = await getApiWithToken(`/week-offs${params}`, null, {
      requiredPermissions: ["WEEK_OFF_VIEW"]
    });
    if (res?.skipped) return;
    if (res?.success) {
      setWeekOffDays(res?.data?.weekOffDays || []);
    } else {
      toast.error(res?.message || "Failed to load week off config");
    }
  };

  useEffect(() => {
    fetchConfigs();
    fetchShifts();
  }, []);

  useEffect(() => {
    const loadSelection = async () => {
      setLoading(true);
      try {
        await fetchConfigForSelection(selectedShiftId);
      } finally {
        setLoading(false);
      }
    };

    loadSelection();
  }, [selectedShiftId]);

  const toggleDay = (value: number) => {
    setWeekOffDays((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value].sort((a, b) => a - b)
    );
  };

  const saveConfig = async () => {
    if (weekOffDays.length === 0) {
      toast.error("Select at least one day");
      return;
    }
    try {
      setSaving(true);
      const payload: any = { weekOffDays };
      if (selectedShiftId !== "default") {
        payload.shiftId = selectedShiftId;
      }
      const res = await postApiWithToken("/week-offs", payload, null, {
        requiredPermissions: ["WEEK_OFF_MANAGE"]
      });
      if (res?.skipped) return;
      if (res?.success) {
        toast.success("Week off configuration saved");
        fetchConfigs();
      } else {
        toast.error(res?.message || "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await Promise.all([fetchConfigForSelection(selectedShiftId), fetchConfigs()]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <MainLayout
      title="Week Off Configuration"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Week Offs" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view week offs.
        </div>
      )}
      {canView && (
        <div className="bg-card rounded-xl card-shadow p-6 max-w-3xl">
        <p className="text-sm text-muted-foreground mb-4">
          Set week offs for default organization policy or for a specific shift.
        </p>

        <div className="mb-5">
          <label className="text-sm font-medium mb-2 block">Apply For</label>
          <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Select target" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default (All Shifts)</SelectItem>
              {shifts.map((shift: any) => (
                <SelectItem key={shift._id} value={shift._id}>
                  {shift.name} ({shift.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {DAYS.map((day) => (
              <div key={day.value} className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded-sm" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {DAYS.map((day) => (
              <label key={day.value} className="flex items-center gap-3">
                <Checkbox
                  checked={weekOffDays.includes(day.value)}
                  onCheckedChange={() => toggleDay(day.value)}
                  disabled={!canManage}
                />
                <span>{day.label}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={handleRefresh} disabled={loading} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
          <PermissionGate permissions={["WEEK_OFF_MANAGE"]}>
            <Button onClick={saveConfig} disabled={loading || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </PermissionGate>
        </div>

        <div className="mt-6 border-t pt-4">
          <h4 className="font-medium mb-2">Configured Policies</h4>
          <div className="space-y-2">
            {loading && Array.from({ length: 3 }).map((_, idx) => (
              <div key={`weekoff-skeleton-${idx}`} className="rounded-md border p-3 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
            ))}
            {!loading && configs.length === 0 && (
              <p className="text-sm text-muted-foreground">No week off configuration yet.</p>
            )}
            {!loading && configs.map((cfg: any) => (
              <div key={cfg._id} className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  {cfg.shiftId ? `${cfg.shiftId.name} (${cfg.shiftId.code})` : "Default (All Shifts)"}
                </p>
                <p className="text-muted-foreground">
                  {(cfg.weekOffDays || [])
                    .map((d: number) => DAYS.find((x) => x.value === d)?.label || d)
                    .join(", ")}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </MainLayout>
  );
};

export default WeekOffs;
