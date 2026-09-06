import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command";
import { Plus, Pencil, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  deleteApiWithToken,
  getApiWithToken,
  postApiWithToken,
  putApiWithToken
} from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";

type ProjectStatus = "active" | "on_hold" | "completed" | "cancelled";
type PaidToValue = string;
type UploadPayload = { fileName: string; mimeType: string; base64Data: string };
type UploadedFileMeta = { fileName?: string; fileUrl?: string; mimeType?: string; uploadedAt?: string };

interface EmployeeOption {
  _id: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
}

interface PaidToEmployee {
  _id?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
}

interface Project {
  _id?: string;
  projectName: string;
  logoUrl?: string;
  clientName: string;
  clientCompany: string;
  clientEmail?: string;
  clientPhone?: string;
  clientAddress?: string;
  actualAmount: number;
  discountedAmount: number;
  paidAmount: number;
  paidTo: PaidToValue | PaidToEmployee | null;
  pendingAmount?: number;
  status: ProjectStatus;
  notes?: string;
  mouFile?: UploadedFileMeta | null;
  documentationFile?: UploadedFileMeta | null;
  mouUpload?: UploadPayload | null;
  documentationUpload?: UploadPayload | null;
}

const emptyProject: Project = {
  projectName: "",
  logoUrl: "",
  clientName: "",
  clientCompany: "",
  clientEmail: "",
  clientPhone: "",
  clientAddress: "",
  actualAmount: 0,
  discountedAmount: 0,
  paidAmount: 0,
  paidTo: "none",
  pendingAmount: 0,
  status: "active",
  notes: "",
  mouUpload: null,
  documentationUpload: null
};

const PROJECT_FILE_MAX_BYTES = 5 * 1024 * 1024;
const PROJECT_FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const formatINR = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(value || 0)
  );

const getPaidToId = (value: Project["paidTo"]) => {
  if (!value) return "none";
  if (typeof value === "string") return value || "none";
  return value._id || "none";
};

const Projects = () => {
  const { hasAnyPermission } = useAuth();
  const canView = hasAnyPermission(["PROJECT_VIEW", "PROJECT_MANAGE"]);
  const canManage = hasAnyPermission(["PROJECT_MANAGE"]);

  const [projects, setProjects] = useState<Project[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [open, setOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [form, setForm] = useState<Project>(emptyProject);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [paidToOpen, setPaidToOpen] = useState(false);

  const pendingAmount = useMemo(() => {
    const discounted = Number(form.discountedAmount || 0);
    const paid = Number(form.paidAmount || 0);
    return Math.max(0, discounted - paid);
  }, [form.discountedAmount, form.paidAmount]);
  const paidToId = useMemo(() => getPaidToId(form.paidTo), [form.paidTo]);
  const paidToLabel = useMemo(() => {
    const selected = employees.find((emp) => emp._id === paidToId);
    if (!selected) return "Select employee *";
    return (
      `${selected.firstName || ""} ${selected.lastName || ""}`.trim() ||
      selected.employeeCode ||
      selected._id
    );
  }, [employees, paidToId]);

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const base64 = result.includes(",") ? result.split(",")[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const validateFile = (file: File, label: string) => {
    if (!PROJECT_FILE_TYPES.includes(file.type)) {
      toast.error(`Invalid ${label} format`);
      return false;
    }
    if (file.size > PROJECT_FILE_MAX_BYTES) {
      toast.error(`${label} size should be under 5MB`);
      return false;
    }
    return true;
  };

  const handleAmountChange = (
    field: "actualAmount" | "discountedAmount" | "paidAmount",
    value: string,
    errorKey: "actualAmount" | "discountedAmount" | "paidAmount"
  ) => {
    const trimmed = value.trim();
    // Allow only non-negative numbers with up to 2 decimal places.
    if (!/^\d*(\.\d{0,2})?$/.test(trimmed)) {
      setErrors((prev) => ({ ...prev, [errorKey]: "Enter a valid number (max 2 decimals)" }));
      return;
    }

    setForm((prev) => ({
      ...prev,
      [field]: trimmed === "" ? 0 : Number(trimmed)
    }));
    if (errors[errorKey]) {
      setErrors((prev) => ({ ...prev, [errorKey]: "" }));
    }
  };

  const fetchProjects = async () => {
    const response = await getApiWithToken("/projects", null, {
      requiredPermissions: ["PROJECT_VIEW", "PROJECT_MANAGE"]
    });
    if (response?.skipped) {
      setProjects([]);
      return;
    }
    if (response?.success) {
      setProjects(response.data || []);
      return;
    }
    toast.error(response?.message || "Failed to load projects");
  };

  const fetchEmployees = async () => {
    const response = await getApiWithToken("/projects/employees", null, {
      requiredPermissions: ["PROJECT_VIEW", "PROJECT_MANAGE"]
    });
    if (response?.success) {
      setEmployees(response.data || []);
      return;
    }
    setEmployees([]);
  };

  useEffect(() => {
    fetchProjects();
    fetchEmployees();
  }, []);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this project?")) return;
    const res = await deleteApiWithToken(`/projects/${id}`);
    if (res?.success) {
      toast.success("Project deleted");
      fetchProjects();
      return;
    }
    toast.error(res?.message || "Delete failed");
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};

    if (!form.projectName.trim()) {
      nextErrors.projectName = "Project name is required";
    } else if (form.projectName.trim().length < 2) {
      nextErrors.projectName = "Project name must be at least 2 characters";
    } else if (form.projectName.trim().length > 100) {
      nextErrors.projectName = "Project name must be under 100 characters";
    }

    if (form.logoUrl && !/^https?:\/\/.+/.test(form.logoUrl.trim())) {
      nextErrors.logoUrl = "Enter a valid URL starting with http:// or https://";
    }

    if (!form.clientName.trim()) {
      nextErrors.clientName = "Client name is required";
    } else if (form.clientName.trim().length < 2) {
      nextErrors.clientName = "Client name must be at least 2 characters";
    } else if (form.clientName.trim().length > 80) {
      nextErrors.clientName = "Client name must be under 80 characters";
    }

    if (form.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.clientEmail.trim())) {
      nextErrors.clientEmail = "Enter a valid email address";
    }

    if (form.clientPhone && !/^[+\d\s\-().]{7,20}$/.test(form.clientPhone.trim())) {
      nextErrors.clientPhone = "Enter a valid phone number";
    }

    const actual = Number(form.actualAmount);
    const discounted = Number(form.discountedAmount);
    const paid = Number(form.paidAmount);

    if (isNaN(actual) || actual < 0) nextErrors.actualAmount = "Enter a valid amount (0 or more)";
    if (isNaN(discounted) || discounted < 0) {
      nextErrors.discountedAmount = "Enter a valid amount (0 or more)";
    } else if (discounted > actual) {
      nextErrors.discountedAmount = "Cannot exceed actual amount";
    }
    if (isNaN(paid) || paid < 0) {
      nextErrors.paidAmount = "Enter a valid amount (0 or more)";
    } else if (paid > discounted) {
      nextErrors.paidAmount = "Cannot exceed discounted amount";
    }

    if (paidToId === "none") nextErrors.paidTo = "Please select the employee who collected payment";

    if (form.clientAddress && form.clientAddress.trim().length > 300) {
      nextErrors.clientAddress = "Address must be under 300 characters";
    }
    if (form.notes && form.notes.trim().length > 1000) {
      nextErrors.notes = "Notes must be under 1000 characters";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error("Please fix form validation errors");
      return;
    }

    const payload = {
      projectName: form.projectName,
      logoUrl: form.logoUrl || "",
      clientName: form.clientName,
      clientCompany: form.clientCompany,
      clientEmail: form.clientEmail || "",
      clientPhone: form.clientPhone || "",
      clientAddress: form.clientAddress || "",
      actualAmount: Number(form.actualAmount || 0),
      discountedAmount: Number(form.discountedAmount || 0),
      paidAmount: Number(form.paidAmount || 0),
      paidTo: paidToId,
      status: form.status,
      notes: form.notes || "",
      mouUpload: form.mouUpload || undefined,
      documentationUpload: form.documentationUpload || undefined
    };

    const res =
      isEdit && form._id
        ? await putApiWithToken(`/projects/${form._id}`, payload, null, {
            requiredPermissions: ["PROJECT_MANAGE"]
          })
        : await postApiWithToken("/projects", payload, null, {
            requiredPermissions: ["PROJECT_MANAGE"]
          });

    if (res?.skipped) return;
    if (res?.success) {
      toast.success(isEdit ? "Project updated" : "Project created");
      setOpen(false);
      setForm(emptyProject);
      setErrors({});
      fetchProjects();
      return;
    }
    toast.error(res?.message || "Operation failed");
  };

  const columns: Column<Project>[] = [
    { header: "Project", accessor: "projectName", sortable: true },
    {
      header: "Client",
      accessor: "clientName",
      render: (row) => (
        <div>
          <div className="font-medium">{row.clientName}</div>
          <div className="text-xs text-muted-foreground">{row.clientCompany || "-"}</div>
        </div>
      )
    },
    {
      header: "Amounts",
      accessor: "actualAmount",
      render: (row) => (
        <div className="text-xs leading-5">
          <div>Actual: {formatINR(row.actualAmount)}</div>
          <div>Discounted: {formatINR(row.discountedAmount)}</div>
          <div>Paid: {formatINR(row.paidAmount)}</div>
          <div className="font-medium">Pending: {formatINR(row.pendingAmount || 0)}</div>
          <div>
            Paid To:{" "}
            {typeof row.paidTo === "object" && row.paidTo
              ? `${(row.paidTo as any).firstName || ""} ${(row.paidTo as any).lastName || ""}`.trim() ||
                (row.paidTo as any).employeeCode ||
                "-"
              : "-"}
          </div>
          <div>
            MOU:{" "}
            {row.mouFile?.fileUrl ? (
              <a href={row.mouFile.fileUrl} className="text-primary underline" target="_blank" rel="noreferrer">
                View
              </a>
            ) : "-"}
          </div>
          <div>
            Documentation:{" "}
            {row.documentationFile?.fileUrl ? (
              <a href={row.documentationFile.fileUrl} className="text-primary underline" target="_blank" rel="noreferrer">
                View
              </a>
            ) : "-"}
          </div>
        </div>
      )
    },
    {
      header: "Status",
      accessor: "status",
      render: (row) => (
        <Badge variant={row.status === "active" ? "default" : "secondary"} className="capitalize">
          {row.status.replace("_", " ")}
        </Badge>
      )
    },
    {
      header: "Actions",
      accessor: "_id",
      render: (row) => (
        <div className="flex gap-3">
          {canManage && (
            <Pencil
              className="w-4 h-4 text-emerald-600 cursor-pointer hover:scale-110"
              onClick={() => {
                setIsEdit(true);
                setErrors({});
                setForm({
                  ...row,
                  paidTo:
                    typeof row.paidTo === "object" && row.paidTo
                      ? (row.paidTo as any)._id
                      : (row.paidTo as string) || "none",
                  logoUrl: row.logoUrl || "",
                  clientEmail: row.clientEmail || "",
                  clientPhone: row.clientPhone || "",
                  clientAddress: row.clientAddress || "",
                  notes: row.notes || "",
                  mouUpload: null,
                  documentationUpload: null
                });
                setOpen(true);
              }}
            />
          )}
          {canManage && row._id && (
            <Trash2
              className="w-4 h-4 text-red-600 cursor-pointer hover:scale-110"
              onClick={() => handleDelete(row._id!)}
            />
          )}
        </div>
      )
    }
  ];

  const stats = useMemo(() => {
    return projects.reduce(
      (acc, row) => {
        acc.totalProjects += 1;
        acc.totalActual += Number(row.actualAmount || 0);
        acc.totalDiscounted += Number(row.discountedAmount || 0);
        acc.totalPaid += Number(row.paidAmount || 0);
        acc.totalPending += Number(row.pendingAmount || 0);
        if (row.status === "active") acc.active += 1;
        if (row.status === "on_hold") acc.onHold += 1;
        if (row.status === "completed") acc.completed += 1;
        if (row.status === "cancelled") acc.cancelled += 1;
        return acc;
      },
      {
        totalProjects: 0,
        active: 0,
        onHold: 0,
        completed: 0,
        cancelled: 0,
        totalActual: 0,
        totalDiscounted: 0,
        totalPaid: 0,
        totalPending: 0
      }
    );
  }, [projects]);

  return (
    <MainLayout
      title="Business Development"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Business Development" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view projects.
        </div>
      )}

      {canView && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="stat-card">
            <p className="text-sm text-muted-foreground mb-1">Total Projects</p>
            <p className="text-2xl font-bold">{stats.totalProjects}</p>
          </div>
          <div className="stat-card">
            <p className="text-sm text-muted-foreground mb-1">Total Discounted</p>
            <p className="text-2xl font-bold">{formatINR(stats.totalDiscounted)}</p>
          </div>
          <div className="stat-card">
            <p className="text-sm text-muted-foreground mb-1">Total Paid</p>
            <p className="text-2xl font-bold">{formatINR(stats.totalPaid)}</p>
          </div>
          <div className="stat-card">
            <p className="text-sm text-muted-foreground mb-1">Total Pending</p>
            <p className="text-2xl font-bold">{formatINR(stats.totalPending)}</p>
          </div>
        </div>
      )}

      {canView && (
        <div className="flex justify-end mb-6">
          {canManage && (
            <Button
              onClick={() => {
                setIsEdit(false);
                setForm(emptyProject);
                setErrors({});
                setOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Project
            </Button>
          )}
        </div>
      )}

      {canView && (
        <DataTable
          columns={canManage ? columns : columns.filter((c) => c.header !== "Actions")}
          data={projects}
          rowKey="_id"
          searchKey="projectName"
        />
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex flex-col gap-0 bg-white p-0">
          <SheetHeader className="border-b border-slate-100 bg-white px-6 py-5 text-left">
            <SheetTitle className="text-2xl font-semibold text-slate-950">{isEdit ? "Edit Project" : "Add Project"}</SheetTitle>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 custom-scroll">
            {/* Basic Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Project Name <span className="text-red-500">*</span></label>
                <Input
                  placeholder="e.g. ERP Revamp - Q2"
                  value={form.projectName}
                  className={errors.projectName ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => {
                    setForm({ ...form, projectName: e.target.value });
                    if (errors.projectName) setErrors({ ...errors, projectName: "" });
                  }}
                />
                {errors.projectName && <p className="text-xs text-red-500 mt-1">{errors.projectName}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Logo URL <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
                <Input
                  placeholder="https://example.com/logo.png"
                  value={form.logoUrl}
                  className={errors.logoUrl ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => {
                    setForm({ ...form, logoUrl: e.target.value });
                    if (errors.logoUrl) setErrors({ ...errors, logoUrl: "" });
                  }}
                />
                {errors.logoUrl && <p className="text-xs text-red-500 mt-1">{errors.logoUrl}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Client Name <span className="text-red-500">*</span></label>
                <Input
                  placeholder="e.g. Rahul Sharma"
                  value={form.clientName}
                  className={errors.clientName ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => {
                    setForm({ ...form, clientName: e.target.value });
                    if (errors.clientName) setErrors({ ...errors, clientName: "" });
                  }}
                />
                {errors.clientName && <p className="text-xs text-red-500 mt-1">{errors.clientName}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Client Company <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
                <Input
                  placeholder="e.g. Acme Corp"
                  value={form.clientCompany}
                  onChange={(e) => setForm({ ...form, clientCompany: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Client Email <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
                <Input
                  type="email"
                  placeholder="client@example.com"
                  value={form.clientEmail}
                  className={errors.clientEmail ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => {
                    setForm({ ...form, clientEmail: e.target.value });
                    if (errors.clientEmail) setErrors({ ...errors, clientEmail: "" });
                  }}
                />
                {errors.clientEmail && <p className="text-xs text-red-500 mt-1">{errors.clientEmail}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Client Phone <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
                <Input
                  placeholder="+91 98765 43210"
                  value={form.clientPhone}
                  className={errors.clientPhone ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => {
                    setForm({ ...form, clientPhone: e.target.value });
                    if (errors.clientPhone) setErrors({ ...errors, clientPhone: "" });
                  }}
                />
                {errors.clientPhone && <p className="text-xs text-red-500 mt-1">{errors.clientPhone}</p>}
              </div>
            </div>

            {/* Financial Details */}
            <div className="rounded-md border border-dashed p-3">
              <p className="text-sm font-medium">Financial Details</p>
              <p className="text-xs text-muted-foreground mt-0.5">Enter all amounts in INR. Pending Amount is auto-calculated.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Actual Amount <span className="text-red-500">*</span></label>
                <p className="text-xs text-muted-foreground">Original quote before discount</p>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.actualAmount}
                  className={errors.actualAmount ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => handleAmountChange("actualAmount", e.target.value, "actualAmount")}
                />
                {errors.actualAmount && <p className="text-xs text-red-500 mt-1">{errors.actualAmount}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Discounted Amount <span className="text-red-500">*</span></label>
                <p className="text-xs text-muted-foreground">Final agreed amount after discount</p>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.discountedAmount}
                  className={errors.discountedAmount ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => handleAmountChange("discountedAmount", e.target.value, "discountedAmount")}
                />
                {errors.discountedAmount && <p className="text-xs text-red-500 mt-1">{errors.discountedAmount}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Paid Amount <span className="text-red-500">*</span></label>
                <p className="text-xs text-muted-foreground">Amount already received from client</p>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={form.paidAmount}
                  className={errors.paidAmount ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => handleAmountChange("paidAmount", e.target.value, "paidAmount")}
                />
                {errors.paidAmount && <p className="text-xs text-red-500 mt-1">{errors.paidAmount}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Pending Amount</label>
                <p className="text-xs text-muted-foreground">Discounted minus paid (auto-calculated)</p>
                <Input value={pendingAmount} disabled className="bg-muted/50 cursor-not-allowed" />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Paid To <span className="text-red-500">*</span></label>
                <p className="text-xs text-muted-foreground">Employee who collected/received payment</p>
                <Popover open={paidToOpen} onOpenChange={setPaidToOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={`w-full justify-between font-normal ${errors.paidTo ? "border-red-500" : ""}`}
                    >
                      <span className="truncate">{paidToLabel}</span>
                      <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search by name or code" />
                      <CommandList>
                        <CommandEmpty>No employees found.</CommandEmpty>
                        <CommandGroup>
                          {employees.map((emp) => {
                            const label =
                              `${emp.firstName || ""} ${emp.lastName || ""}`.trim() ||
                              emp.employeeCode ||
                              emp._id;
                            return (
                              <CommandItem
                                key={emp._id}
                                value={`${label} ${emp.employeeCode || ""}`}
                                onSelect={() => {
                                  setForm({ ...form, paidTo: emp._id });
                                  if (errors.paidTo) setErrors({ ...errors, paidTo: "" });
                                  setPaidToOpen(false);
                                }}
                              >
                                {label}
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {employees.length === 0 && (
                  <p className="text-xs text-muted-foreground">No active employees found.</p>
                )}
                {errors.paidTo && <p className="text-xs text-red-500 mt-1">{errors.paidTo}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Status</label>
                <p className="text-xs text-muted-foreground">Current lifecycle status of this project</p>
                <Select
                  value={form.status}
                  onValueChange={(v: ProjectStatus) => setForm({ ...form, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="on_hold">On Hold</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Address & Notes */}
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Client Address <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
                <Textarea
                  placeholder="City, state, country"
                  value={form.clientAddress}
                  className={errors.clientAddress ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => {
                    setForm({ ...form, clientAddress: e.target.value });
                    if (errors.clientAddress) setErrors({ ...errors, clientAddress: "" });
                  }}
                />
                {errors.clientAddress && <p className="text-xs text-red-500 mt-1">{errors.clientAddress}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Notes <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
                <Textarea
                  placeholder="Scope, timeline, payment remarks…"
                  value={form.notes}
                  className={errors.notes ? "border-red-500 focus-visible:ring-red-500" : ""}
                  onChange={(e) => {
                    setForm({ ...form, notes: e.target.value });
                    if (errors.notes) setErrors({ ...errors, notes: "" });
                  }}
                />
                {errors.notes && <p className="text-xs text-red-500 mt-1">{errors.notes}</p>}
              </div>
            </div>

            {/* File Uploads */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">MOU Upload <span className="text-xs font-normal text-muted-foreground">(PDF / image, max 5 MB)</span></label>
                <Input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!validateFile(file, "MOU")) return;
                    const base64Data = await fileToBase64(file);
                    setForm({ ...form, mouUpload: { fileName: file.name, mimeType: file.type, base64Data } });
                  }}
                />
                {form.mouUpload?.fileName && (
                  <p className="text-xs text-muted-foreground">{form.mouUpload.fileName}</p>
                )}
                {!form.mouUpload?.fileName && form.mouFile?.fileUrl && (
                  <a href={form.mouFile.fileUrl} className="text-xs text-primary underline" target="_blank" rel="noreferrer">
                    View current MOU
                  </a>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Documentation Upload <span className="text-xs font-normal text-muted-foreground">(PDF / image, max 5 MB)</span></label>
                <Input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!validateFile(file, "Documentation")) return;
                    const base64Data = await fileToBase64(file);
                    setForm({ ...form, documentationUpload: { fileName: file.name, mimeType: file.type, base64Data } });
                  }}
                />
                {form.documentationUpload?.fileName && (
                  <p className="text-xs text-muted-foreground">{form.documentationUpload.fileName}</p>
                )}
                {!form.documentationUpload?.fileName && form.documentationFile?.fileUrl && (
                  <a href={form.documentationFile.fileUrl} className="text-xs text-primary underline" target="_blank" rel="noreferrer">
                    View current documentation
                  </a>
                )}
              </div>
            </div>

          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-5">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>
              {isEdit ? "Update Project" : "Create Project"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default Projects;
