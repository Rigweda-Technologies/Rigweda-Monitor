import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { getApiWithToken, postApiWithToken, putApiWithToken, deleteApiWithToken } from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { formatDateInOrgTimeZone } from "@/utils/timezone";
import { toast } from "sonner";
import { Pencil, Trash2, Plus, Link as LinkIcon, RefreshCw } from "lucide-react";

const categoryOptions = [
  { value: "assets", label: "Assets" },
  { value: "office_rent", label: "Office Rent" },
  { value: "utilities", label: "Utilities" },
  { value: "software", label: "Software" },
  { value: "travel", label: "Travel" },
  { value: "maintenance", label: "Maintenance" },
  { value: "salary", label: "Salary" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" }
];

const paymentModeOptions = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "card", label: "Card" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" }
];

const makeEmptyForm = () => ({
  category: "assets",
  title: "",
  vendorId: "none",
  vendor: "",
  expenseDate: new Date().toISOString().slice(0, 10),
  amount: "",
  taxAmount: "0",
  paymentMode: "bank_transfer",
  reimbursementMethod: "none",
  purchasedBy: "none",
  reimbursementAmount: "",
  reimbursementPayrollMonth: "",
  reimbursementNote: "",
  notes: "",
  receiptUrl: ""
});

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(Number(value || 0));

const toReceiptLink = (url: string) => {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const apiBase = import.meta.env.VITE_API_BASE_URL || "";
  try {
    const parsed = new URL(apiBase);
    return `${parsed.protocol}//${parsed.host}${url.startsWith("/") ? url : `/${url}`}`;
  } catch {
    return url;
  }
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

const mergeExpensePages = (existing: any[], incoming: any[]) => {
  const merged = new Map<string, any>();
  existing.forEach((item) => {
    if (item?._id) merged.set(String(item._id), item);
  });
  incoming.forEach((item) => {
    if (item?._id) merged.set(String(item._id), item);
  });
  return Array.from(merged.values());
};

const Expenses = () => {
  const { hasAnyPermission } = useAuth();
  const canView = hasAnyPermission(["EXPENSE_VIEW", "EXPENSE_MANAGE"]);
  const canManage = hasAnyPermission(["EXPENSE_MANAGE"]);
  const canAction = hasAnyPermission(["EXPENSE_ACTION"]);

  const [rows, setRows] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [reimbursementStatusFilter, setReimbursementStatusFilter] = useState("all");
  const [recordFilter, setRecordFilter] = useState<"active" | "deleted" | "all">("active");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(makeEmptyForm());
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const pageSize = 10;
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);
  const resetPaginationRef = useRef(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectExpenseId, setRejectExpenseId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [vendorOpen, setVendorOpen] = useState(false);
  const [vendorEditId, setVendorEditId] = useState<string | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [vendorActive, setVendorActive] = useState(true);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (employeeFilter !== "all") params.set("employeeId", employeeFilter);
    if (reimbursementStatusFilter !== "all") params.set("reimbursementStatus", reimbursementStatusFilter);
    if (recordFilter !== "active") params.set("includeDeleted", "true");
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const q = params.toString();
    return q ? `?${q}` : "";
  }, [categoryFilter, statusFilter, employeeFilter, reimbursementStatusFilter, recordFilter, startDate, endDate]);

  const employeeOptions = useMemo(
    () =>
      (employees || []).map((emp) => ({
        id: String(emp._id),
        name: `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.employeeCode || "Unknown"
      })),
    [employees]
  );

  const visibleRows = useMemo(() => {
    const byRecord =
      recordFilter === "all"
        ? rows
        : recordFilter === "deleted"
          ? rows.filter((r) => Boolean(r.isDeleted))
          : rows.filter((r) => !r.isDeleted);

    if (employeeFilter === "all") return byRecord;
    return byRecord.filter((row) => String(row.purchasedBy?._id || row.createdBy?._id || "") === employeeFilter);
  }, [rows, recordFilter, employeeFilter]);

  useEffect(() => {
    if (employeeFilter === "all") return;
    const stillExists = employeeOptions.some((emp) => emp.id === employeeFilter);
    if (!stillExists) {
      setEmployeeFilter("all");
    }
  }, [employeeFilter, employeeOptions]);

  const computedSummary = useMemo(() => {
    const totals = (visibleRows || []).reduce(
      (acc, row) => {
        const amount = Number(row.amount || 0);
        const tax = Number(row.taxAmount || 0);
        acc.totalAmount += amount;
        acc.totalTax += tax;
        acc.netSpend += amount + tax;
        acc.count += 1;
        return acc;
      },
      { totalAmount: 0, totalTax: 0, netSpend: 0, count: 0 }
    );

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const thisMonth = (visibleRows || []).reduce(
      (acc, row) => {
        const dateKey = row.expenseDate ? String(row.expenseDate).slice(0, 7) : null;
        if (!dateKey || dateKey !== currentMonthKey) {
          return acc;
        }
        const amount = Number(row.amount || 0);
        const tax = Number(row.taxAmount || 0);
        acc.totalAmount += amount;
        acc.totalTax += tax;
        acc.netSpend += amount + tax;
        acc.count += 1;
        return acc;
      },
      { totalAmount: 0, totalTax: 0, netSpend: 0, count: 0 }
    );

    return { totals, thisMonth };
  }, [visibleRows]);

  const fetchVendors = async () => {
    const res = await getApiWithToken("/expenses/vendors", null, {
      requiredPermissions: ["EXPENSE_VIEW", "EXPENSE_MANAGE"]
    });
    if (res?.success) {
      setVendors(res.data || []);
    } else if (res && !res.skipped) {
      toast.error(res?.message || "Failed to load vendors");
    }
  };

  const fetchEmployees = async () => {
    const res = await getApiWithToken("/expenses/employees", null, {
      requiredPermissions: ["EXPENSE_VIEW", "EXPENSE_MANAGE"]
    });
    if (res?.success) {
      setEmployees(res.data || []);
    } else if (res && !res.skipped) {
      setEmployees([]);
      toast.error(res?.message || "Failed to load employees");
    }
  };

  const fetchData = async () => {
    if (!canView) return;
    const isLoadMoreRequest = currentPage > 1;
    if (isLoadMoreRequest) setLoadingMore(true);
    else setLoading(true);
    try {
      const pagedQuery = `${queryString}${queryString ? "&" : "?"}page=${currentPage}&limit=${pageSize}`;
      const [listRes, summaryRes] = await Promise.all([
        getApiWithToken(`/expenses${pagedQuery}`, null, {
          requiredPermissions: ["EXPENSE_VIEW", "EXPENSE_MANAGE"]
        }),
        getApiWithToken(`/expenses/summary${queryString}`, null, {
          requiredPermissions: ["EXPENSE_VIEW", "EXPENSE_MANAGE"]
        })
      ]);

      if (listRes?.success) {
        const payload = listRes.data;
        const nextRows = Array.isArray(payload) ? payload : (payload?.items || []);
        const pagination = Array.isArray(payload)
          ? { page: currentPage, totalPages: 1, total: nextRows.length }
          : payload?.pagination;
        setRows((prev) => (currentPage > 1 ? mergeExpensePages(prev, nextRows) : nextRows));
        setTotalItems(Number(pagination?.total || nextRows.length));
        setTotalPages(Math.max(1, Number(pagination?.totalPages || 1)));
      } else {
        setRows([]);
        if (listRes && !listRes.skipped) toast.error(listRes?.message || "Failed to load expenses");
      }

      if (summaryRes?.success) {
        setSummary(summaryRes.data || null);
      } else {
        setSummary(null);
      }
    } finally {
      loadingMoreRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    resetPaginationRef.current = true;
    loadingMoreRef.current = false;
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTop = 0;
    }
    setCurrentPage(1);
    setRows([]);
  }, [queryString]);

  useEffect(() => {
    if (resetPaginationRef.current && currentPage !== 1) {
      return;
    }
    if (resetPaginationRef.current && currentPage === 1) {
      resetPaginationRef.current = false;
    }
    fetchData();
  }, [queryString, canView, currentPage]);

  const refreshExpenseList = async () => {
    setRows([]);
    if (currentPage === 1) {
      await fetchData();
      return;
    }
    setCurrentPage(1);
  };

  useEffect(() => {
    if (!canView) return;
    fetchVendors();
    fetchEmployees();
  }, [canView]);

  const openCreate = () => {
    setIsEdit(false);
    setEditingId(null);
    setForm(makeEmptyForm());
    setFormErrors({});
    setOpen(true);
  };

  const openEdit = (row: any) => {
    setIsEdit(true);
    setEditingId(row._id);
    setForm({
      category: row.category || "other",
      title: row.title || "",
      vendorId: row.vendorId?._id || "none",
      vendor: row.vendor || "",
      expenseDate: row.expenseDate ? String(row.expenseDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
      amount: String(row.amount ?? ""),
      taxAmount: String(row.taxAmount ?? 0),
      paymentMode: row.paymentMode || "bank_transfer",
      reimbursementMethod: row.reimbursementMethod || "none",
      purchasedBy: row.purchasedBy?._id || "none",
      reimbursementAmount: String(row.reimbursementAmount ?? ""),
      reimbursementPayrollMonth: row.reimbursementPayrollMonth || "",
      reimbursementNote: row.reimbursementNote || "",
      notes: row.notes || "",
      receiptUrl: row.receiptUrl || ""
    });
    setFormErrors({});
    setOpen(true);
  };

  const handleSubmit = async () => {
    const newErrors: Record<string, string> = {};

    if (!form.title.trim()) {
      newErrors.title = "Title is required";
    } else if (form.title.trim().length < 2) {
      newErrors.title = "Title must be at least 2 characters";
    } else if (form.title.trim().length > 150) {
      newErrors.title = "Title must be under 150 characters";
    }

    if (!form.expenseDate) {
      newErrors.expenseDate = "Expense date is required";
    }

    if (form.amount === "" || form.amount === null || form.amount === undefined) {
      newErrors.amount = "Amount is required";
    } else if (isNaN(Number(form.amount))) {
      newErrors.amount = "Enter a valid number";
    } else if (Number(form.amount) < 0) {
      newErrors.amount = "Amount must be 0 or more";
    }

    if (form.taxAmount !== "" && (isNaN(Number(form.taxAmount)) || Number(form.taxAmount) < 0)) {
      newErrors.taxAmount = "Tax amount must be 0 or more";
    }

    if (form.reimbursementMethod === "payroll") {
      if (form.purchasedBy === "none") {
        newErrors.purchasedBy = "Select an employee for payroll reimbursement";
      }
      if (form.reimbursementAmount !== "" && (isNaN(Number(form.reimbursementAmount)) || Number(form.reimbursementAmount) < 0)) {
        newErrors.reimbursementAmount = "Reimbursement amount must be 0 or more";
      }
      if (form.reimbursementPayrollMonth && !/^\d{4}-\d{2}$/.test(form.reimbursementPayrollMonth)) {
        newErrors.reimbursementPayrollMonth = "Enter a valid month (YYYY-MM)";
      }
    }

    if (form.notes && form.notes.length > 500) {
      newErrors.notes = "Notes must be under 500 characters";
    }

    if (Object.keys(newErrors).length > 0) {
      setFormErrors(newErrors);
      return;
    }
    setFormErrors({});

    const payload: any = {
      category: form.category,
      title: form.title.trim(),
      vendor: form.vendor.trim(),
      expenseDate: form.expenseDate,
      amount: Number(form.amount || 0),
      taxAmount: Number(form.taxAmount || 0),
      paymentMode: form.paymentMode,
      reimbursementMethod: form.reimbursementMethod,
      purchasedBy: form.reimbursementMethod === "payroll" && form.purchasedBy !== "none" ? form.purchasedBy : null,
      reimbursementAmount:
        form.reimbursementMethod === "payroll"
          ? Number(form.reimbursementAmount || Number(form.amount || 0) + Number(form.taxAmount || 0))
          : 0,
      reimbursementPayrollMonth: form.reimbursementMethod === "payroll" ? form.reimbursementPayrollMonth : "",
      reimbursementNote: form.reimbursementMethod === "payroll" ? form.reimbursementNote : "",
      notes: form.notes,
      receiptUrl: form.receiptUrl
    };

    if (form.vendorId !== "none") {
      payload.vendorId = form.vendorId;
    }

    let res;
    if (isEdit && editingId) {
      res = await putApiWithToken(`/expenses/${editingId}`, payload, null, {
        requiredPermissions: ["EXPENSE_MANAGE"]
      });
    } else {
      res = await postApiWithToken("/expenses", payload, null, {
        requiredPermissions: ["EXPENSE_MANAGE"]
      });
    }

    if (res?.success) {
      toast.success(isEdit ? "Expense updated" : "Expense added");
      setOpen(false);
      refreshExpenseList();
    } else if (!res?.skipped) {
      toast.error(res?.message || "Save failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this expense?")) return;
    const res = await deleteApiWithToken(`/expenses/${id}`);
    if (res?.success) {
      toast.success("Expense deleted");
      refreshExpenseList();
    } else {
      toast.error(res?.message || "Delete failed");
    }
  };

  const handleAction = async (id: string, status: "approved" | "rejected", rejectionReason = "") => {
    const res = await putApiWithToken(
      `/expenses/${id}/action`,
      { status, rejectionReason },
      null,
      { requiredPermissions: ["EXPENSE_ACTION"] }
    );
    if (res?.success) {
      toast.success(`Expense ${status}`);
      refreshExpenseList();
    } else if (!res?.skipped) {
      toast.error(res?.message || "Action failed");
    }
  };

  const handleReimbursementUpdate = async (
    id: string,
    reimbursementStatus: "pending" | "queued" | "paid",
    reimbursementPayrollMonth = "",
    reimbursementNote = ""
  ) => {
    const res = await putApiWithToken(
      `/expenses/${id}/reimbursement`,
      { reimbursementStatus, reimbursementPayrollMonth, reimbursementNote },
      null,
      { requiredPermissions: ["EXPENSE_MANAGE"] }
    );
    if (res?.success) {
      toast.success("Reimbursement status updated");
      refreshExpenseList();
    } else if (!res?.skipped) {
      toast.error(res?.message || "Failed to update reimbursement");
    }
  };

  const openRejectDialog = (id: string) => {
    setRejectExpenseId(id);
    setRejectReason("");
    setRejectOpen(true);
  };

  const submitReject = async () => {
    if (!rejectExpenseId) return;
    if (rejectReason.trim().length < 3) {
      toast.error("Rejection reason must be at least 3 characters");
      return;
    }
    await handleAction(rejectExpenseId, "rejected", rejectReason.trim());
    setRejectOpen(false);
    setRejectExpenseId(null);
    setRejectReason("");
  };

  const handleRestore = async (id: string) => {
    const res = await putApiWithToken(
      `/expenses/${id}/restore`,
      {},
      null,
      { requiredPermissions: ["EXPENSE_MANAGE"] }
    );
    if (res?.success) {
      toast.success("Expense restored");
      refreshExpenseList();
    } else if (!res?.skipped) {
      toast.error(res?.message || "Restore failed");
    }
  };

  const handleReceiptUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const fileData = await fileToDataUrl(file);
      const res = await postApiWithToken(
        "/expenses/upload-receipt",
        { fileName: file.name, fileData },
        null,
        { requiredPermissions: ["EXPENSE_MANAGE"] }
      );

      if (res?.success) {
        setForm((prev) => ({ ...prev, receiptUrl: res.data?.receiptUrl || "" }));
        toast.success("Receipt uploaded");
      } else if (!res?.skipped) {
        toast.error(res?.message || "Receipt upload failed");
      }
    } catch {
      toast.error("Receipt upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const openVendorCreate = () => {
    setVendorEditId(null);
    setVendorName("");
    setVendorActive(true);
    setVendorOpen(true);
  };

  const openVendorEdit = (vendor: any) => {
    setVendorEditId(vendor._id);
    setVendorName(vendor.name || "");
    setVendorActive(Boolean(vendor.isActive));
    setVendorOpen(true);
  };

  const saveVendor = async () => {
    if (!vendorName.trim()) {
      toast.error("Vendor name is required");
      return;
    }

    const payload = { name: vendorName.trim(), isActive: vendorActive };
    const res = vendorEditId
      ? await putApiWithToken(`/expenses/vendors/${vendorEditId}`, payload, null, {
        requiredPermissions: ["EXPENSE_MANAGE"]
      })
      : await postApiWithToken("/expenses/vendors", payload, null, {
        requiredPermissions: ["EXPENSE_MANAGE"]
      });

    if (res?.success) {
      toast.success(vendorEditId ? "Vendor updated" : "Vendor created");
      setVendorOpen(false);
      fetchVendors();
      refreshExpenseList();
    } else if (!res?.skipped) {
      toast.error(res?.message || "Vendor save failed");
    }
  };

  const deleteVendor = async (vendorId: string) => {
    if (!window.confirm("Delete this vendor?")) return;
    const res = await deleteApiWithToken(`/expenses/vendors/${vendorId}`);
    if (res?.success) {
      toast.success("Vendor deleted");
      fetchVendors();
    } else {
      toast.error(res?.message || "Vendor delete failed");
    }
  };

  const onSelectVendor = (value: string) => {
    if (value === "none") {
      setForm((prev) => ({ ...prev, vendorId: "none" }));
      return;
    }
    const selected = vendors.find((v) => v._id === value);
    setForm((prev) => ({
      ...prev,
      vendorId: value,
      vendor: selected?.name || prev.vendor
    }));
  };

  const vendorAnalytics = summary?.byVendor || [];
  const effectiveSummary = summary || computedSummary;
  const hasMoreExpenses = currentPage < totalPages;

  const handleExpenseTableScroll = () => {
    const viewport = tableViewportRef.current;
    if (!viewport || loading || loadingMore || loadingMoreRef.current || !hasMoreExpenses) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    if (scrollTop <= 0 || scrollHeight <= clientHeight) return;
    const progress = (scrollTop + clientHeight) / scrollHeight;
    if (progress < 0.5) return;
    loadingMoreRef.current = true;
    setCurrentPage((prev) => {
      if (prev >= totalPages) {
        loadingMoreRef.current = false;
        return prev;
      }
      return prev + 1;
    });
  };

  return (
    <MainLayout
      title="Expenses"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Expenses" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view expenses.
        </div>
      )}

      {canView && (
        <>
          {loading ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={`expense-stat-skeleton-${idx}`} className="stat-card space-y-3">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-8 w-32" />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                <div className="bg-card rounded-xl card-shadow p-4 lg:col-span-2 space-y-3">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <Skeleton key={`vendor-analytics-skeleton-${idx}`} className="h-10 w-full rounded-md" />
                  ))}
                </div>

                {canManage && (
                  <div className="bg-card rounded-xl card-shadow p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="h-8 w-16" />
                    </div>
                    {Array.from({ length: 3 }).map((_, idx) => (
                      <Skeleton key={`vendor-master-skeleton-${idx}`} className="h-14 w-full rounded-md" />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="stat-card">
                  <p className="text-sm text-muted-foreground mb-1">Total Expense</p>
                  <p className="text-2xl font-bold">{formatMoney(effectiveSummary.totals.totalAmount)}</p>
                </div>
                <div className="stat-card">
                  <p className="text-sm text-muted-foreground mb-1">Total Tax</p>
                  <p className="text-2xl font-bold">{formatMoney(effectiveSummary.totals.totalTax)}</p>
                </div>
                <div className="stat-card">
                  <p className="text-sm text-muted-foreground mb-1">Net Spend</p>
                  <p className="text-2xl font-bold">{formatMoney(effectiveSummary.totals.netSpend)}</p>
                </div>
                <div className="stat-card">
                  <p className="text-sm text-muted-foreground mb-1">This Month Spend</p>
                  <p className="text-2xl font-bold">{formatMoney(effectiveSummary.thisMonth.netSpend)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                <div className="bg-card rounded-xl card-shadow p-4 lg:col-span-2 overflow-x-auto">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Top Vendors</h3>
                    <span className="text-xs text-muted-foreground">Vendor-wise spend analytics</span>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Count</TableHead>
                        <TableHead>Net Spend</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(vendorAnalytics.length ? vendorAnalytics.slice(0, 6) : []).map((row: any) => (
                        <TableRow key={row.vendorKey || row.vendor}>
                          <TableCell>{row.vendor || "Unspecified"}</TableCell>
                          <TableCell>{row.count || 0}</TableCell>
                          <TableCell>{formatMoney(row.netSpend || 0)}</TableCell>
                        </TableRow>
                      ))}
                      {(!vendorAnalytics || vendorAnalytics.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-muted-foreground">No vendor analytics yet</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {canManage && (
                  <div className="bg-card rounded-xl card-shadow p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold">Vendor Master</h3>
                      <Button size="sm" onClick={openVendorCreate}>
                        <Plus className="w-4 h-4 mr-1" /> Add
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-52 overflow-auto">
                      {vendors.length === 0 && (
                        <p className="text-sm text-muted-foreground">No vendors added</p>
                      )}
                      {vendors.map((vendor) => (
                        <div key={vendor._id} className="border rounded-lg p-2 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{vendor.name}</p>
                            <Badge variant="outline" className="mt-1">
                              {vendor.isActive ? "active" : "inactive"}
                            </Badge>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => openVendorEdit(vendor)}>Edit</Button>
                            <Button size="sm" variant="outline" onClick={() => deleteVendor(vendor._id)}>Delete</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-end gap-3 mb-6">
            <div>
              <Label>Category</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>From</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Employee</Label>
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="All Employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {employeeOptions.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reimbursement</Label>
              <Select value={reimbursementStatusFilter} onValueChange={setReimbursementStatusFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="not_applicable">Not Applicable</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="queued">Queued Payroll</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div>
              <Label>Records</Label>
              <Select value={recordFilter} onValueChange={(value: any) => setRecordFilter(value)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="deleted">Deleted</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => { setStartDate(""); setEndDate(""); setCategoryFilter("all"); setStatusFilter("all"); setEmployeeFilter("all"); setReimbursementStatusFilter("all"); setRecordFilter("active"); }}>
              Reset
            </Button>
            <Button variant="outline" onClick={refreshExpenseList} disabled={loading || loadingMore} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            {canManage && (
              <Button onClick={openCreate} className="ml-auto">
                <Plus className="w-4 h-4 mr-2" /> Add Expense
              </Button>
            )}
          </div>

          <div className="bg-card rounded-xl card-shadow overflow-hidden">
            <div
              ref={tableViewportRef}
              onScroll={handleExpenseTableScroll}
              className="max-h-[60vh] overflow-auto"
            >
            <Table>
              <TableHeader>
                <TableRow className="table-header">
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Tax</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Reimbursement</TableHead>
                  {(canManage || canAction) && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 && Array.from({ length: 6 }).map((_, idx) => (
                  <TableRow key={`expense-skeleton-${idx}`}>
                    {Array.from({ length: (canManage || canAction) ? 12 : 11 }).map((__, colIdx) => (
                      <TableCell key={colIdx}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {!loading && visibleRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={(canManage || canAction) ? 12 : 11} className="text-muted-foreground">No expenses found</TableCell>
                  </TableRow>
                )}
                {!loading && visibleRows.map((row) => (
                  <TableRow key={row._id} className="table-row-hover">
                    <TableCell>{row.expenseDate ? formatDateInOrgTimeZone(row.expenseDate) : "-"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {categoryOptions.find((c) => c.value === row.category)?.label || row.category}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.title}</TableCell>
                    <TableCell>{row.vendor || "-"}</TableCell>
                    <TableCell>{formatMoney(row.amount)}</TableCell>
                    <TableCell>{formatMoney(row.taxAmount || 0)}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          row.status === "approved"
                            ? "status-badge status-active"
                            : row.status === "rejected"
                              ? "status-badge status-rejected"
                              : row.isDeleted
                                ? "status-badge status-inactive"
                                : "status-badge status-pending"
                        }
                      >
                        {row.isDeleted ? "deleted" : (row.status || "pending")}
                      </Badge>
                    </TableCell>
                    <TableCell>{paymentModeOptions.find((p) => p.value === row.paymentMode)?.label || row.paymentMode}</TableCell>
                    <TableCell>
                      {row.receiptUrl ? (
                        <a className="text-emerald-600 underline inline-flex items-center gap-1" href={toReceiptLink(row.receiptUrl)} target="_blank" rel="noreferrer">
                          <LinkIcon className="w-3 h-3" /> View
                        </a>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                      {(row.purchasedBy || row.createdBy)
                        ? `${row.purchasedBy?.firstName || row.createdBy?.firstName || ""} ${row.purchasedBy?.lastName || row.createdBy?.lastName || ""}`.trim()
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {row.reimbursementMethod === "payroll" ? (
                        <Badge
                          className={
                            row.reimbursementStatus === "paid"
                              ? "status-badge status-active"
                              : row.reimbursementStatus === "queued"
                                ? "status-badge status-pending"
                                : "status-badge status-inactive"
                          }
                        >
                          {row.reimbursementStatus || "pending"}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Not Applicable</Badge>
                      )}
                    </TableCell>
                    {(canManage || canAction) && (
                      <TableCell>
                        <div className="flex gap-3">
                          {canManage && row.isDeleted && (
                            <Button size="sm" variant="outline" onClick={() => handleRestore(row._id)}>
                              Restore
                            </Button>
                          )}
                          {canManage && !row.isDeleted && row.status === "pending" && (
                            <>
                              <Pencil
                                className="w-4 h-4 text-emerald-600 cursor-pointer hover:scale-110"
                                onClick={() => openEdit(row)}
                              />
                              <Trash2
                                className="w-4 h-4 text-red-600 cursor-pointer hover:scale-110"
                                onClick={() => handleDelete(row._id)}
                              />
                            </>
                          )}
                          {canAction && !row.isDeleted && row.status === "pending" && (
                            <>
                              <Button size="sm" onClick={() => handleAction(row._id, "approved")}>
                                Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => openRejectDialog(row._id)}>
                                Reject
                              </Button>
                            </>
                          )}
                          {canManage && !row.isDeleted && row.status === "approved" && row.reimbursementMethod === "payroll" && row.reimbursementStatus !== "paid" && (
                            <>
                              {row.reimbursementStatus !== "queued" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const month = new Date().toISOString().slice(0, 7);
                                    handleReimbursementUpdate(row._id, "queued", month, "Queued for payroll release");
                                  }}
                                >
                                  Queue Payroll
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReimbursementUpdate(row._id, "paid", row.reimbursementPayrollMonth || new Date().toISOString().slice(0, 7), "Released via payroll")}
                              >
                                Mark Paid
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground flex items-center justify-between">
              <span>Showing {rows.length} of {totalItems} expenses</span>
              <span>
                {loadingMore
                  ? "Loading more expenses..."
                  : hasMoreExpenses
                    ? "Scroll past 50% to load more"
                    : "You have reached the end"}
              </span>
            </div>
          </div>
        </>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 overflow-visible bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">{isEdit ? "Edit Expense" : "Add Expense"}</SheetTitle>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto overflow-x-visible px-6 py-5 md:grid-cols-2">
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(value) => setForm((p) => ({ ...p, category: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Expense Date</Label>
              <Input type="date" value={form.expenseDate} onChange={(e) => setForm((p) => ({ ...p, expenseDate: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div>
              <Label>Vendor (Master)</Label>
              <Select value={form.vendorId} onValueChange={onSelectVendor}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor._id} value={vendor._id}>{vendor.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vendor Name</Label>
              <Input
                value={form.vendor}
                onChange={(e) => setForm((p) => ({ ...p, vendor: e.target.value }))}
                disabled={form.vendorId !== "none"}
                placeholder={form.vendorId !== "none" ? "Auto-filled from vendor master" : "Optional"}
              />
            </div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={form.paymentMode} onValueChange={(value) => setForm((p) => ({ ...p, paymentMode: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {paymentModeOptions.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reimbursement Method</Label>
              <Select
                value={form.reimbursementMethod}
                onValueChange={(value) =>
                  setForm((p) => ({
                    ...p,
                    reimbursementMethod: value,
                    purchasedBy: value === "payroll" ? (p.purchasedBy === "none" ? "none" : p.purchasedBy) : "none"
                  }))
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not Applicable</SelectItem>
                  <SelectItem value="payroll">Payroll Reimbursement</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.reimbursementMethod === "payroll" && (
              <>
                <div>
                  <Label>Purchased By</Label>
                  <Select value={form.purchasedBy} onValueChange={(value) => setForm((p) => ({ ...p, purchasedBy: value }))}>
                    <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select employee</SelectItem>
                      {employeeOptions.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Reimbursement Amount</Label>
                  <Input
                    type="number"
                    min={0}
                    value={form.reimbursementAmount}
                    onChange={(e) => setForm((p) => ({ ...p, reimbursementAmount: e.target.value }))}
                    placeholder="Defaults to Amount + Tax"
                  />
                </div>
                <div>
                  <Label>Payroll Month (YYYY-MM)</Label>
                  <Input
                    value={form.reimbursementPayrollMonth}
                    onChange={(e) => setForm((p) => ({ ...p, reimbursementPayrollMonth: e.target.value }))}
                    placeholder="2026-02"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label>Reimbursement Note</Label>
                  <Textarea
                    value={form.reimbursementNote}
                    onChange={(e) => setForm((p) => ({ ...p, reimbursementNote: e.target.value }))}
                    placeholder="Will be released via payroll"
                  />
                </div>
              </>
            )}
            <div>
              <Label>Amount</Label>
              <Input type="number" min={0} value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <Label>Tax Amount</Label>
              <Input type="number" min={0} value={form.taxAmount} onChange={(e) => setForm((p) => ({ ...p, taxAmount: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <Label>Receipt</Label>
              <div className="flex flex-col gap-2">
                <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleReceiptUpload} disabled={uploading} />
                {uploading && <span className="text-sm text-muted-foreground">Uploading receipt...</span>}
              </div>
              {form.receiptUrl && (
                <a className="text-emerald-600 underline text-sm mt-2 inline-block" href={toReceiptLink(form.receiptUrl)} target="_blank" rel="noreferrer">
                  View uploaded receipt
                </a>
              )}
            </div>
            <div className="md:col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <SheetFooter className="shrink-0 border-t border-slate-100 bg-white px-6 py-5">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{isEdit ? "Update" : "Create"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Enter rejection reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={submitReject}>Submit Rejection</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={vendorOpen} onOpenChange={setVendorOpen}>
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">
              {vendorEditId ? "Edit Vendor" : "Add Vendor"}
            </SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5">
            <div>
              <Label>Name</Label>
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={vendorActive ? "active" : "inactive"} onValueChange={(value) => setVendorActive(value === "active")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setVendorOpen(false)}>Cancel</Button>
            <Button onClick={saveVendor}>{vendorEditId ? "Update" : "Create"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default Expenses;
