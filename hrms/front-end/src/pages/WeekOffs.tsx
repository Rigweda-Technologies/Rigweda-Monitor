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
import { Building2, CalendarDays, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";

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

  const selectedShift = shifts.find((shift: any) => shift._id === selectedShiftId);
  const selectedTargetLabel =
    selectedShiftId === "default"
      ? "Default (All Shifts)"
      : selectedShift
        ? `${selectedShift.name} (${selectedShift.code})`
        : "Selected Shift";
  const selectedDayLabels = weekOffDays
    .map((value) => DAYS.find((day) => day.value === value)?.label)
    .filter(Boolean);

  return (
    <MainLayout
      title="Week Off Configuration"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Week Offs" }]}
    >
      {!canView && (
        <div className="rounded-[28px] border border-slate-100 bg-white p-6 text-sm text-slate-500 shadow-sm">
          You do not have permission to view week offs.
        </div>
      )}
      {canView && (
        <div className="space-y-6 rounded-[28px] bg-[#f8f8f6] p-3 sm:p-5 lg:p-6">
          <div className="relative overflow-hidden rounded-[32px] border border-white bg-gradient-to-br from-emerald-500 via-teal-500 to-slate-900 p-6 text-white shadow-sm sm:p-8">
            <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
            <div className="absolute bottom-0 right-16 h-24 w-24 rounded-full bg-yellow-300/20 blur-xl" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-medium backdrop-blur">
                  <CalendarDays className="h-4 w-4" />
                  Organization Policy
                </div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Week Offs</h1>
                <p className="mt-2 max-w-2xl text-sm text-white/80 sm:text-base">
                  Configure weekly holidays for all employees or override them for a specific shift.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:min-w-[360px]">
                <div className="rounded-2xl bg-white/15 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-wide text-white/70">Selected Days</p>
                  <p className="mt-2 text-3xl font-semibold">{weekOffDays.length}</p>
                </div>
                <div className="rounded-2xl bg-white/15 p-4 backdrop-blur">
                  <p className="text-xs uppercase tracking-wide text-white/70">Policies</p>
                  <p className="mt-2 text-3xl font-semibold">{configs.length}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <section className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">Configure Policy</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Current target: <span className="font-medium text-slate-700">{selectedTargetLabel}</span>
                  </p>
                </div>
                <div className="w-full lg:max-w-sm">
                  <label className="mb-2 block text-sm font-medium text-slate-700">Apply For</label>
                  <Select value={selectedShiftId} onValueChange={setSelectedShiftId}>
                    <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-slate-50">
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
              </div>

              {loading ? (
                <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {DAYS.map((day) => (
                    <div key={day.value} className="rounded-2xl border border-slate-100 p-4">
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="mt-3 h-4 w-20" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {DAYS.map((day) => {
                    const selected = weekOffDays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => canManage && toggleDay(day.value)}
                        disabled={!canManage}
                        className={`group flex min-h-24 items-start justify-between rounded-2xl border p-4 text-left transition-all ${
                          selected
                            ? "border-emerald-200 bg-emerald-50 shadow-sm ring-1 ring-emerald-100"
                            : "border-slate-100 bg-slate-50 hover:border-emerald-200 hover:bg-white"
                        } ${!canManage ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                      >
                        <span>
                          <span className={`block text-base font-semibold ${selected ? "text-emerald-900" : "text-slate-900"}`}>
                            {day.label}
                          </span>
                          <span className={`mt-2 block text-xs ${selected ? "text-emerald-700" : "text-slate-500"}`}>
                            {selected ? "Marked as week off" : "Working day"}
                          </span>
                        </span>
                        <span className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                          selected
                            ? "border-emerald-500 bg-emerald-500 text-white"
                            : "border-slate-200 bg-white text-transparent group-hover:border-emerald-300"
                        }`}>
                          <CheckCircle2 className="h-4 w-4" />
                        </span>
                        <Checkbox
                          className="sr-only"
                          checked={selected}
                          onCheckedChange={() => toggleDay(day.value)}
                          disabled={!canManage}
                          aria-label={`Toggle ${day.label}`}
                        />
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  {selectedDayLabels.length ? selectedDayLabels.join(", ") : "No week off selected"}
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button variant="outline" onClick={handleRefresh} disabled={loading} className="h-11 gap-2 rounded-2xl">
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    {loading ? "Refreshing..." : "Refresh"}
                  </Button>
                  <PermissionGate permissions={["WEEK_OFF_MANAGE"]}>
                    <Button onClick={saveConfig} disabled={loading || saving} className="h-11 rounded-2xl bg-emerald-500 px-6 hover:bg-emerald-600">
                      {saving ? "Saving..." : "Save Policy"}
                    </Button>
                  </PermissionGate>
                </div>
              </div>
            </section>

            <aside className="space-y-6">
              <section className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-950">Current Selection</h3>
                    <p className="text-sm text-slate-500">{selectedTargetLabel}</p>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  {selectedDayLabels.length ? (
                    selectedDayLabels.map((label) => (
                      <span key={label} className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
                        {label}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-500">
                      No days selected
                    </span>
                  )}
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950">Configured Policies</h3>
                    <p className="mt-1 text-sm text-slate-500">Saved defaults and shift-specific rules.</p>
                  </div>
                  <Building2 className="h-5 w-5 text-slate-400" />
                </div>
                <div className="mt-5 space-y-3">
                  {loading && Array.from({ length: 3 }).map((_, idx) => (
                    <div key={`weekoff-skeleton-${idx}`} className="rounded-2xl border border-slate-100 p-4">
                      <Skeleton className="h-4 w-44" />
                      <Skeleton className="mt-3 h-4 w-56" />
                    </div>
                  ))}
                  {!loading && configs.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      No week off configuration yet.
                    </div>
                  )}
                  {!loading && configs.map((cfg: any) => {
                    const labels = (cfg.weekOffDays || [])
                      .map((dayValue: number) => DAYS.find((day) => day.value === dayValue)?.label || dayValue)
                      .join(", ");
                    return (
                      <div key={cfg._id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-sm transition hover:border-emerald-100 hover:bg-white">
                        <p className="font-semibold text-slate-900">
                          {cfg.shiftId ? `${cfg.shiftId.name} (${cfg.shiftId.code})` : "Default (All Shifts)"}
                        </p>
                        <p className="mt-1 text-slate-500">{labels || "No days configured"}</p>
                      </div>
                    );
                  })}
                </div>
              </section>
            </aside>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default WeekOffs;
