import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postApiWithToken, getApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { DateRange } from "react-day-picker";
import { useLocation, useNavigate } from "react-router-dom";

type LeaveType = {
  _id: string;
  name: string;
  code?: string;
};

type LeaveDuration = "full_day" | "half_day";
type HalfDaySession = "first_half" | "second_half";

type LeaveBalance = {
  leaveTypeId: string;
  total: number;
  used: number;
  pending?: number;
  remaining: number;
  cycleStartYear?: number;
};

type CalendarLeave = {
  _id: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  effectiveDateKeys?: string[];
  status: "pending" | "approved";
};

type LeaveApplyWindow = {
  attendanceLockEnabled?: boolean;
  attendanceLockMode?: "days_window" | "payroll_cutoff";
  payrollCutoffDay?: number;
  attendanceLockDay?: number;
  attendanceLockAfterDays?: number;
  earliestAllowedDateKey?: string | null;
};

type LeaveRestriction = {
  blocked: boolean;
  reason: string;
};

type DayMeta = {
  date: Date;
  excluded: boolean;
};

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateInput = (value: string) => {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
};

const parseDateKey = (value: string) => {
  const [y, m, d] = String(value || "").split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
};

const datesInRange = (from: Date, to: Date) => {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const dates: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
};

const getApplicableLeaveDays = ({
  from,
  to,
  weekOffDays,
  holidayKeys,
  sandwichRuleEnabled
}: {
  from?: Date;
  to?: Date;
  weekOffDays: number[];
  holidayKeys: Set<string>;
  sandwichRuleEnabled: boolean;
}) => {
  if (!from || !to) return 0;
  const dayMeta: DayMeta[] = datesInRange(from, to).map((d) => ({
    date: d,
    excluded: weekOffDays.includes(d.getDay()) || holidayKeys.has(dateKey(d))
  }));

  if (!sandwichRuleEnabled) {
    return dayMeta.filter((d) => !d.excluded).length;
  }

  const firstWorkingIdx = dayMeta.findIndex((d) => !d.excluded);
  const lastWorkingIdx = dayMeta.length - 1 - [...dayMeta].reverse().findIndex((d) => !d.excluded);
  if (firstWorkingIdx === -1 || lastWorkingIdx === -1) return 0;

  return dayMeta.filter((d, index) => !d.excluded || (index > firstWorkingIdx && index < lastWorkingIdx)).length;
};

const getRangeExcludedDays = ({
  from,
  to,
  weekOffDays,
  holidayKeys
}: {
  from?: Date;
  to?: Date;
  weekOffDays: number[];
  holidayKeys: Set<string>;
}) => {
  if (!from || !to) return 0;
  return datesInRange(from, to).filter((d) => weekOffDays.includes(d.getDay()) || holidayKeys.has(dateKey(d))).length;
};

const LEAVE_REASON_REGEX = /^(?=.*[A-Za-z])[A-Za-z\s.,'()&/-]+$/;

const LeaveApply = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [myLeaves, setMyLeaves] = useState<CalendarLeave[]>([]);
  const [weekOffDays, setWeekOffDays] = useState<number[]>([]);
  const [holidayKeys, setHolidayKeys] = useState<Set<string>>(new Set());
  const [sandwichRuleEnabled, setSandwichRuleEnabled] = useState(false);
  const [leaveApplyWindow, setLeaveApplyWindow] = useState<LeaveApplyWindow | null>(null);
  const [leaveRestriction, setLeaveRestriction] = useState<LeaveRestriction>({ blocked: false, reason: "" });
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [reason, setReason] = useState("");
  const [selectedRange, setSelectedRange] = useState<DateRange | undefined>();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [duration, setDuration] = useState<LeaveDuration>("full_day");
  const [halfDaySession, setHalfDaySession] = useState<HalfDaySession>("first_half");
  const [isMobile, setIsMobile] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(new Date());
  const backTarget = (location.state as { from?: string } | null)?.from || "/leave";

  const resetForm = () => {
    setLeaveTypeId("");
    setReason("");
    setSelectedRange(undefined);
    setFromDate("");
    setToDate("");
    setDuration("full_day");
    setHalfDaySession("first_half");
    setVisibleMonth(new Date());
  };

  const loadContext = async () => {
    try {
      setLoading(true);
      const res = await getApiWithToken("/leaves/apply-context", null, {
        requiredPermissions: ["LEAVE_APPLY"]
      });
      if (res?.skipped) return;
      if (!res?.success) {
        toast.error(res?.message || "Failed to load leave apply data");
        return;
      }

      const data = res.data || {};
      setLeaveTypes(data.leaveTypes || []);
      setMyLeaves(data.myLeaves || []);
      setWeekOffDays(data.weekOffDays || []);
      setSandwichRuleEnabled(Boolean(data.sandwichRuleEnabled));
      setLeaveApplyWindow(data.leaveApplyWindow || null);
      setLeaveRestriction(data.leaveRestriction || { blocked: false, reason: "" });
      setBalances(data.balances || []);
      setHolidayKeys(new Set((data.holidays || []).map((h: any) => dateKey(new Date(h.date)))));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContext();
  }, []);

  useEffect(() => {
    const updateMobile = () => setIsMobile(window.innerWidth < 768);
    updateMobile();
    window.addEventListener("resize", updateMobile);
    return () => window.removeEventListener("resize", updateMobile);
  }, []);

  useEffect(() => {
    const startDate = selectedRange?.from || parseDateInput(fromDate);
    if (startDate) {
      setVisibleMonth(new Date(startDate.getFullYear(), startDate.getMonth(), 1));
    }
  }, [selectedRange?.from, fromDate]);

  const approvedDates = useMemo(() => {
    const result: Date[] = [];
    (myLeaves || [])
      .filter((l) => l.status === "approved")
      .forEach((l) => {
        if (Array.isArray(l.effectiveDateKeys) && l.effectiveDateKeys.length > 0) {
          result.push(
            ...l.effectiveDateKeys
              .map((key) => parseDateKey(key))
              .filter((value): value is Date => Boolean(value))
          );
          return;
        }
        result.push(...datesInRange(new Date(l.fromDate), new Date(l.toDate)));
      });
    return result;
  }, [myLeaves]);

  const approvedDateKeySet = useMemo(
    () => new Set(approvedDates.map((date) => dateKey(date))),
    [approvedDates]
  );

  const pendingDates = useMemo(() => {
    const result: Date[] = [];
    (myLeaves || [])
      .filter((l) => l.status === "pending")
      .forEach((l) => {
        if (Array.isArray(l.effectiveDateKeys) && l.effectiveDateKeys.length > 0) {
          result.push(
            ...l.effectiveDateKeys
              .map((key) => parseDateKey(key))
              .filter((value): value is Date => Boolean(value))
          );
          return;
        }
        result.push(...datesInRange(new Date(l.fromDate), new Date(l.toDate)));
      });
    return result;
  }, [myLeaves]);

  const pendingDateKeySet = useMemo(
    () => new Set(pendingDates.map((date) => dateKey(date))),
    [pendingDates]
  );

  const selectedBalance = useMemo(() => {
    if (!leaveTypeId) return null;
    const candidates = balances.filter((b) => b.leaveTypeId?.toString() === leaveTypeId);
    if (!candidates.length) return null;
    return candidates.sort((a, b) => (b.cycleStartYear || 0) - (a.cycleStartYear || 0))[0];
  }, [leaveTypeId, balances]);

  const disabledMatcher = (date: Date) => {
    const weekOff = weekOffDays.includes(date.getDay());
    const holiday = holidayKeys.has(dateKey(date));
    const lockedByWindow =
      Boolean(leaveApplyWindow?.earliestAllowedDateKey) && dateKey(date) < leaveApplyWindow!.earliestAllowedDateKey!;
    return weekOff || holiday || lockedByWindow;
  };

  const applicableDays = useMemo(() => {
    const days = getApplicableLeaveDays({
      from: selectedRange?.from,
      to: selectedRange?.to,
      weekOffDays,
      holidayKeys,
      sandwichRuleEnabled
    });
    if (duration === "half_day" && days > 0) return 0.5;
    return days;
  }, [selectedRange, weekOffDays, holidayKeys, sandwichRuleEnabled, duration]);

  const selectedExcludedDays = useMemo(() => {
    return getRangeExcludedDays({
      from: selectedRange?.from,
      to: selectedRange?.to,
      weekOffDays,
      holidayKeys
    });
  }, [holidayKeys, selectedRange, weekOffDays]);

  const dateError = useMemo(() => {
    if (!fromDate || !toDate) return "";
    if (fromDate > toDate) {
      return "Please check the selected dates. From Date cannot be greater than To Date.";
    }
    if (leaveApplyWindow?.earliestAllowedDateKey) {
      if (fromDate < leaveApplyWindow.earliestAllowedDateKey || toDate < leaveApplyWindow.earliestAllowedDateKey) {
        if (leaveApplyWindow.attendanceLockMode === "payroll_cutoff") {
          return `Leave cannot be applied before ${leaveApplyWindow.earliestAllowedDateKey}.`;
        }
        return `Leave cannot be applied for dates older than ${leaveApplyWindow.attendanceLockAfterDays || 0} days.`;
      }
    }
    return "";
  }, [fromDate, toDate, leaveApplyWindow]);

  const onRangeChange = (range: DateRange | undefined) => {
    if (duration === "half_day") {
      const single = range?.from;
      setSelectedRange(single ? { from: single, to: single } : undefined);
      setFromDate(single ? dateKey(single) : "");
      setToDate(single ? dateKey(single) : "");
      return;
    }
    setSelectedRange(range);
    setFromDate(range?.from ? dateKey(range.from) : "");
    setToDate(range?.to ? dateKey(range.to) : "");
  };

  const onFromDateChange = (value: string) => {
    setFromDate(value);
    const from = parseDateInput(value);
    const to = duration === "half_day" ? from : parseDateInput(toDate);
    if (duration === "half_day") {
      setToDate(value);
    }
    setSelectedRange({ from, to });
  };

  const onToDateChange = (value: string) => {
    setToDate(value);
    const from = parseDateInput(fromDate);
    const to = parseDateInput(value);
    setSelectedRange({ from, to });
  };

  const onDurationChange = (value: LeaveDuration) => {
    setDuration(value);
    if (value === "half_day") {
      const singleFrom = selectedRange?.from || parseDateInput(fromDate);
      const singleDate = singleFrom ? dateKey(singleFrom) : fromDate;
      setSelectedRange(singleFrom ? { from: singleFrom, to: singleFrom } : undefined);
      if (singleDate) {
        setFromDate(singleDate);
        setToDate(singleDate);
      }
    }
  };

  const submit = async () => {
    if (!leaveTypeId || !fromDate || !toDate) {
      toast.error("Leave type and both dates are required");
      return;
    }
    if (leaveRestriction.blocked) {
      toast.error(leaveRestriction.reason || "Leave application is currently unavailable");
      return;
    }
    if (dateError) {
      toast.error(dateError);
      return;
    }
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error("Reason is required");
      return;
    }
    if (trimmedReason.length < 3) {
      toast.error("Reason must be at least 3 characters");
      return;
    }
    if (trimmedReason.length > 500) {
      toast.error("Reason must be at most 500 characters");
      return;
    }
    if (!LEAVE_REASON_REGEX.test(trimmedReason)) {
      toast.error("Reason must contain meaningful text (letters only, no numbers)");
      return;
    }
    if (applicableDays <= 0) {
      toast.error("Selected dates only include holidays/week-offs");
      return;
    }

    try {
      setSubmitting(true);
      const res = await postApiWithToken(
        "/leaves/apply",
        { leaveTypeId, fromDate, toDate, duration, halfDaySession, reason: trimmedReason },
        null,
        { requiredPermissions: ["LEAVE_APPLY"] }
      );
      if (res?.skipped) return;
      if (res?.success) {
        toast.success("Leave applied successfully");
        resetForm();
        await loadContext();
      } else {
        toast.error(res?.message || "Failed to apply leave");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MainLayout
      title="Apply Leave"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Leave", href: "/leave" }, { label: "Apply" }]}
    >
      <div className="mb-4">
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => {
            if ((location.state as { from?: string } | null)?.from) {
              navigate(backTarget);
              return;
            }
            if (window.history.length > 1) {
              navigate(-1);
              return;
            }
            navigate("/leave");
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <Card className="lg:col-span-7 min-w-0">
          <CardHeader>
            <CardTitle>Leave Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading calendar...</p>
            ) : (
              <>
                <div className="w-full overflow-x-auto">
                  <Calendar
                    mode="range"
                    selected={selectedRange}
                    onSelect={onRangeChange}
                    month={visibleMonth}
                    onMonthChange={setVisibleMonth}
                    numberOfMonths={isMobile ? 1 : 2}
                    disabled={disabledMatcher}
                    classNames={{
                      months: "flex flex-col sm:flex-row flex-wrap gap-4",
                      month: "space-y-4 min-w-[270px]"
                    }}
                    modifiers={{
                      weekOff: (date) => {
                        const key = dateKey(date);
                        return weekOffDays.includes(date.getDay()) && !approvedDateKeySet.has(key) && !pendingDateKeySet.has(key);
                      },
                      holiday: (date) => {
                        const key = dateKey(date);
                        return holidayKeys.has(key) && !approvedDateKeySet.has(key) && !pendingDateKeySet.has(key);
                      },
                      approved: approvedDates,
                      pending: pendingDates
                    }}
                    modifiersClassNames={{
                      weekOff: "bg-sky-100 text-sky-700 border border-sky-300 rounded-md !opacity-100",
                      holiday: "bg-rose-100 text-rose-700 border border-rose-300 rounded-md !opacity-100",
                      approved: "bg-green-100 text-green-700 border border-green-300 font-semibold rounded-md !opacity-100",
                      pending: "bg-orange-100 text-orange-700 border border-orange-300 font-semibold rounded-md !opacity-100"
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs mt-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded bg-green-100 border border-green-300" />
                    Approved leave
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded bg-orange-100 border border-orange-300" />
                    Pending leave
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded bg-sky-100 border border-sky-300" />
                    Week off
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded bg-rose-100 border border-rose-300" />
                    Holiday
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-5 min-w-0 lg:max-w-[620px] lg:justify-self-end">
          <CardHeader>
            <CardTitle>Leave Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {leaveRestriction.blocked && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {leaveRestriction.reason}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div className="md:col-span-2 space-y-2">
                <Label>Leave Type</Label>
                <Select value={leaveTypeId} onValueChange={setLeaveTypeId} disabled={leaveRestriction.blocked}>
                  <SelectTrigger>
                    <SelectValue placeholder={leaveRestriction.blocked ? "Leave types unavailable" : "Select leave type"} />
                  </SelectTrigger>
                  <SelectContent>
                    {leaveTypes.map((lt) => (
                      <SelectItem key={lt._id} value={lt._id}>
                        {lt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Leave Balance</p>
                <p className="text-lg font-semibold">
                  {selectedBalance ? `${selectedBalance.remaining}/${selectedBalance.total}` : "-/-"}
                </p>
                {selectedBalance && (
                  <div className="text-xs text-muted-foreground mt-1 space-y-1">
                    <p>Available: {selectedBalance.remaining}</p>
                    <p>Pending: {selectedBalance.pending || 0}</p>
                    <p>Used: {selectedBalance.used}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Duration</Label>
                <Select value={duration} onValueChange={(value) => onDurationChange(value as LeaveDuration)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select duration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_day">Full Day</SelectItem>
                    <SelectItem value="half_day">Half Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {duration === "half_day" && (
                <div className="space-y-2">
                  <Label>Session</Label>
                  <Select
                    value={halfDaySession}
                    onValueChange={(value) => setHalfDaySession(value as HalfDaySession)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select session" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first_half">First Half</SelectItem>
                      <SelectItem value="second_half">Second Half</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Date</Label>
                <Input
                  type="date"
                  min={leaveApplyWindow?.earliestAllowedDateKey || undefined}
                  value={fromDate}
                  onChange={(e) => onFromDateChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>To Date</Label>
                <Input
                  type="date"
                  min={fromDate || leaveApplyWindow?.earliestAllowedDateKey || undefined}
                  value={toDate}
                  disabled={duration === "half_day"}
                  onChange={(e) => onToDateChange(e.target.value)}
                />
              </div>
            </div>

            {dateError && <p className="text-sm text-destructive">{dateError}</p>}
            {!dateError && leaveApplyWindow?.attendanceLockEnabled && leaveApplyWindow?.earliestAllowedDateKey && (
              <p className="text-sm text-muted-foreground">
                {leaveApplyWindow.attendanceLockMode === "payroll_cutoff"
                  ? `You can apply leave from ${leaveApplyWindow.earliestAllowedDateKey} onwards based on attendance lock day ${leaveApplyWindow.attendanceLockDay ?? leaveApplyWindow.payrollCutoffDay ?? "-"}.`
                  : `You can apply leave for dates within the last ${leaveApplyWindow.attendanceLockAfterDays} days.`}
              </p>
            )}

            <div className="space-y-2">
              <Label>Reason</Label>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter leave reason"
              />
            </div>

            <div className="rounded-lg border p-3 text-sm">
              Applicable leave days {sandwichRuleEnabled ? "(sandwich rule enabled):" : "(excluding holidays/week-offs):"}{" "}
              <span className="font-semibold">{applicableDays}</span>
            </div>

            {sandwichRuleEnabled && selectedExcludedDays > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Sandwich rule deducts holidays or week offs only when those non-working days fall between two leave-applied working days. If leave exists on only one sibling side, those non-working days are not deducted.
              </div>
            )}

            <div className="flex flex-wrap justify-start gap-3 sm:justify-end">
              <Button
                variant="outline"
                onClick={resetForm}
                disabled={submitting || loading}
              >
                Reset
              </Button>
              <Button onClick={submit} disabled={submitting || loading || Boolean(dateError) || leaveRestriction.blocked}>
                {submitting ? "Applying..." : "Apply Leave"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default LeaveApply;
