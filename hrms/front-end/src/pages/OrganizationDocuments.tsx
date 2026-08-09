import { useEffect, useMemo, useRef, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import PayrollSectionNav from "@/components/payroll/PayrollSectionNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { deleteApiWithToken, getApiWithToken, postApiWithToken } from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { getToken } from "@/utils/auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  FileArchive,
  FileText,
  Search,
  ShieldAlert,
  Trash2,
  UploadCloud
} from "lucide-react";

type DocumentStatus = "ACTIVE" | "EXPIRED" | "PENDING";

type CatalogDocument = {
  key: string;
  category: string;
  name: string;
  mandatory: boolean;
  uploaded?: boolean;
};

type CatalogGroup = {
  category: string;
  documents: CatalogDocument[];
};

type UploadHistoryItem = {
  action: string;
  fileName: string;
  uploadedAt: string;
};

type OrganizationDocument = {
  _id: string;
  documentCategory: string;
  documentKey: string;
  documentName: string;
  documentNumber?: string;
  fileName: string;
  fileType: string;
  fileSize?: number;
  previewUrl?: string;
  downloadUrl?: string;
  uploadedAt?: string;
  expiryDate?: string | null;
  status: DocumentStatus;
  remarks?: string;
  uploadHistory?: UploadHistoryItem[];
};

type Summary = {
  totalUploadedDocuments: number;
  missingMandatoryDocuments: number;
  expiredDocuments: number;
  expiringSoonDocuments: number;
  missingMandatory: CatalogDocument[];
  expired: OrganizationDocument[];
  expiringSoon: OrganizationDocument[];
};

type UploadForm = {
  documentKey: string;
  documentNumber: string;
  expiryDate: string;
  remarks: string;
  file: File | null;
};

const ALL_CATEGORIES = "all";
const ALL_STATUSES = "all";
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const IMAGE_COMPRESS_TARGET_BYTES = 420 * 1024;
const IMAGE_COMPRESS_MAX_SIDE = 1200;
const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

const FALLBACK_CATALOG: CatalogGroup[] = [
  {
    category: "Company Documents",
    documents: [
      { key: "COMPANY_PAN", category: "Company Documents", name: "Company PAN Card", mandatory: true },
      { key: "GST_CERTIFICATE", category: "Company Documents", name: "GST Certificate", mandatory: false },
      { key: "CERTIFICATE_OF_INCORPORATION", category: "Company Documents", name: "Certificate of Incorporation", mandatory: false },
      { key: "TAN_ALLOTMENT", category: "Company Documents", name: "TAN Allotment Letter", mandatory: true },
      { key: "SHOP_ESTABLISHMENT", category: "Company Documents", name: "Shop & Establishment Certificate", mandatory: false },
      { key: "MSME_CERTIFICATE", category: "Company Documents", name: "MSME Certificate", mandatory: false }
    ]
  },
  {
    category: "PF / ESIC Documents",
    documents: [
      { key: "PF_REGISTRATION", category: "PF / ESIC Documents", name: "PF Registration Certificate", mandatory: true },
      { key: "PF_ESTABLISHMENT_CODE", category: "PF / ESIC Documents", name: "PF Establishment Code Document", mandatory: false },
      { key: "ESIC_REGISTRATION", category: "PF / ESIC Documents", name: "ESIC Registration Certificate", mandatory: true },
      { key: "PT_REGISTRATION", category: "PF / ESIC Documents", name: "PT Registration Certificate", mandatory: true }
    ]
  },
  {
    category: "Bank & Financial Documents",
    documents: [
      { key: "CANCELLED_CHEQUE", category: "Bank & Financial Documents", name: "Cancelled Cheque", mandatory: false },
      { key: "BANK_ACCOUNT_PROOF", category: "Bank & Financial Documents", name: "Bank Account Proof", mandatory: true },
      { key: "AUTHORIZED_SIGNATORY", category: "Bank & Financial Documents", name: "Authorized Signatory Documents", mandatory: false }
    ]
  },
  {
    category: "Payroll Compliance Documents",
    documents: [
      { key: "SALARY_STRUCTURE_POLICY", category: "Payroll Compliance Documents", name: "Salary Structure Policy", mandatory: false },
      { key: "LEAVE_POLICY", category: "Payroll Compliance Documents", name: "Leave Policy", mandatory: false },
      { key: "ATTENDANCE_POLICY", category: "Payroll Compliance Documents", name: "Attendance Policy", mandatory: false },
      { key: "EMPLOYEE_HANDBOOK", category: "Payroll Compliance Documents", name: "Employee Handbook", mandatory: false },
      { key: "OFFER_LETTER_TEMPLATES", category: "Payroll Compliance Documents", name: "Offer Letter Templates", mandatory: false },
      { key: "PAYSLIP_TEMPLATE", category: "Payroll Compliance Documents", name: "Payslip Template", mandatory: false }
    ]
  }
];

const getFallbackMissingDocuments = () =>
  FALLBACK_CATALOG.flatMap((group) => group.documents).filter((document) => document.mandatory);

const emptySummary: Summary = {
  totalUploadedDocuments: 0,
  missingMandatoryDocuments: getFallbackMissingDocuments().length,
  expiredDocuments: 0,
  expiringSoonDocuments: 0,
  missingMandatory: getFallbackMissingDocuments(),
  expired: [],
  expiringSoon: []
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",")[1] : value);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const loadImageFromFile = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read image file"));
    };
    image.src = url;
  });

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to compress image"));
    }, type, quality);
  });

const compressImageFile = async (file: File) => {
  if (!["image/jpeg", "image/png"].includes(file.type)) return file;
  if (file.size <= IMAGE_COMPRESS_TARGET_BYTES) return file;

  const image = await loadImageFromFile(file);
  let scale = Math.min(1, IMAGE_COMPRESS_MAX_SIDE / Math.max(image.width, image.height));
  let width = Math.max(1, Math.round(image.width * scale));
  let height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return file;

  const outputType = "image/jpeg";
  let quality = 0.82;
  let blob: Blob | null = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    width = Math.max(1, Math.round(image.width * scale));
    height = Math.max(1, Math.round(image.height * scale));
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    blob = await canvasToBlob(canvas, outputType, quality);
    while (blob.size > IMAGE_COMPRESS_TARGET_BYTES && quality > 0.34) {
      quality -= 0.08;
      blob = await canvasToBlob(canvas, outputType, quality);
    }
    if (blob.size <= IMAGE_COMPRESS_TARGET_BYTES) break;
    scale *= 0.75;
    quality = 0.72;
  }

  if (!blob || blob.size >= file.size) return file;
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}-compressed.jpg`, {
    type: outputType,
    lastModified: Date.now()
  });
};

const formatDate = (value?: string | null) => {
  if (!value) return "-";
  return new Date(value).toLocaleDateString();
};

const formatFileSize = (bytes?: number) => {
  if (!bytes) return "-";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getStatusBadge = (status: DocumentStatus) => {
  if (status === "EXPIRED") return <Badge variant="destructive">Expired</Badge>;
  if (status === "PENDING") return <Badge variant="secondary">Pending</Badge>;
  return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge>;
};

const getApiBaseUrl = () => String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

const OrganizationDocuments = () => {
  const { hasAnyPermission } = useAuth();
  const [documents, setDocuments] = useState<OrganizationDocument[]>([]);
  const [catalog, setCatalog] = useState<CatalogGroup[]>(FALLBACK_CATALOG);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [status, setStatus] = useState(ALL_STATUSES);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<UploadForm>({
    documentKey: "",
    documentNumber: "",
    expiryDate: "",
    remarks: "",
    file: null
  });

  const canView = hasAnyPermission(["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]);
  const canManage = hasAnyPermission(["ORG_DOCUMENT_UPLOAD", "ORG_DOCUMENT_DELETE", "ORG_SETTINGS_MANAGE", "PAYROLL_CONFIG_MANAGE"]);

  const documentByKey = useMemo(() => {
    return documents.reduce((acc, doc) => {
      acc.set(doc.documentKey, doc);
      return acc;
    }, new Map<string, OrganizationDocument>());
  }, [documents]);

  const categories = useMemo(() => catalog.map((group) => group.category), [catalog]);

  const visibleCatalog = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return catalog
      .filter((group) => category === ALL_CATEGORIES || group.category === category)
      .map((group) => ({
        ...group,
        documents: group.documents.filter((item) => {
          const uploaded = documentByKey.get(item.key);
          const currentStatus = uploaded?.status || "PENDING";
          const matchesStatus = status === ALL_STATUSES || currentStatus === status;
          const haystack = `${item.name} ${uploaded?.documentNumber || ""} ${uploaded?.remarks || ""}`.toLowerCase();
          return matchesStatus && (!normalizedSearch || haystack.includes(normalizedSearch));
        })
      }))
      .filter((group) => group.documents.length > 0);
  }, [catalog, category, documentByKey, search, status]);

  const loadData = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const [listRes, summaryRes] = await Promise.all([
        getApiWithToken("/organization-documents?includeHistory=true", null, {
          requiredPermissions: ["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]
        }),
        getApiWithToken("/organization-documents/summary", null, {
          requiredPermissions: ["ORG_DOCUMENT_VIEW", "ORG_SETTINGS_VIEW", "PAYROLL_REPORT_VIEW"]
        })
      ]);
      if (listRes?.success) {
        setDocuments(listRes.data?.items || []);
        setCatalog(listRes.data?.catalog?.length ? listRes.data.catalog : FALLBACK_CATALOG);
      } else if (!listRes?.skipped) {
        setCatalog(FALLBACK_CATALOG);
        toast.error(listRes?.message || "Failed to load documents");
      }
      if (summaryRes?.success) {
        setSummary(summaryRes.data || emptySummary);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [canView]);

  const validateFile = (file: File) => {
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      toast.error("Upload PDF, JPG, PNG, or DOCX files only");
      return false;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error("File size must be 8MB or less");
      return false;
    }
    return true;
  };

  const pickFile = async (file: File | null) => {
    if (!file || !validateFile(file)) return;
    try {
      const uploadFile = await compressImageFile(file);
      if (!validateFile(uploadFile)) return;
      if (uploadFile.size < file.size) {
        toast.success(`Compressed image from ${formatFileSize(file.size)} to ${formatFileSize(uploadFile.size)}`);
      }
      setForm((prev) => ({ ...prev, file: uploadFile }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to compress image");
    }
  };

  const openUpload = (documentKey: string) => {
    const existing = documentByKey.get(documentKey);
    setForm({
      documentKey,
      documentNumber: existing?.documentNumber || "",
      expiryDate: existing?.expiryDate ? existing.expiryDate.slice(0, 10) : "",
      remarks: existing?.remarks || "",
      file: null
    });
    setDialogOpen(true);
  };

  const submitUpload = async () => {
    if (!form.documentKey || !form.file) {
      toast.error("Select a document file");
      return;
    }
    const approximateJsonBytes = Math.ceil(form.file.size * 1.37);
    if (["image/jpeg", "image/png"].includes(form.file.type) && approximateJsonBytes > 900 * 1024) {
      toast.error("Image is still too large after compression. Please choose a smaller image.");
      return;
    }
    setUploading(true);
    try {
      const base64Data = await fileToBase64(form.file);
      const res = await postApiWithToken("/organization-documents/upload", {
        documentKey: form.documentKey,
        documentNumber: form.documentNumber,
        expiryDate: form.expiryDate || null,
        remarks: form.remarks,
        file: {
          fileName: form.file.name,
          mimeType: form.file.type,
          size: form.file.size,
          base64Data
        }
      }, null, { requiredPermissions: ["ORG_DOCUMENT_UPLOAD", "ORG_SETTINGS_MANAGE", "PAYROLL_CONFIG_MANAGE"] });
      if (res?.success) {
        toast.success("Document saved");
        setDialogOpen(false);
        await loadData();
      } else if (!res?.skipped) {
        toast.error(res?.message || "Upload failed");
      }
    } finally {
      setUploading(false);
    }
  };

  const openDocumentBlob = async (doc: OrganizationDocument, mode: "preview" | "download") => {
    const token = getToken();
    const response = await fetch(`${getApiBaseUrl()}/organization-documents/${doc._id}/${mode}`, {
      headers: token ? { Authorization: token.includes("Bearer") ? token : `Bearer ${token}` } : {}
    });
    if (!response.ok) {
      toast.error(mode === "preview" ? "Preview failed" : "Download failed");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    if (mode === "download") {
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.fileName || "document";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const openPreview = async (doc: OrganizationDocument) => {
    await openDocumentBlob(doc, "preview");
  };

  const downloadDocument = async (doc: OrganizationDocument) => {
    await openDocumentBlob(doc, "download");
  };

  const deleteDocument = async (doc: OrganizationDocument) => {
    if (!window.confirm(`Delete ${doc.documentName}?`)) return;
    const res = await deleteApiWithToken(`/organization-documents/${doc._id}`);
    if (res?.success) {
      toast.success("Document deleted");
      await loadData();
    } else {
      toast.error(res?.message || "Delete failed");
    }
  };

  return (
    <MainLayout
      title="Organization Documents"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Organization" }, { label: "Documents" }]}
    >
      <PayrollSectionNav />

      {!canView && (
        <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          You do not have permission to view organization documents.
        </div>
      )}

      {canView && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Uploaded</p>
                <FileArchive className="h-4 w-4 text-slate-500" />
              </div>
              <p className="mt-2 text-2xl font-semibold">{summary.totalUploadedDocuments}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Missing Mandatory</p>
                <ShieldAlert className="h-4 w-4 text-amber-600" />
              </div>
              <p className="mt-2 text-2xl font-semibold text-amber-700">{summary.missingMandatoryDocuments}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Expired</p>
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </div>
              <p className="mt-2 text-2xl font-semibold text-red-700">{summary.expiredDocuments}</p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Expiring Soon</p>
                <FileText className="h-4 w-4 text-indigo-600" />
              </div>
              <p className="mt-2 text-2xl font-semibold text-indigo-700">{summary.expiringSoonDocuments}</p>
            </div>
          </div>

          {(summary.missingMandatoryDocuments > 0 || summary.expiredDocuments > 0) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  <p className="font-medium">Compliance alerts need attention</p>
                  <p className="mt-1">
                    Missing: {summary.missingMandatory.map((item) => item.name).join(", ") || "None"}.
                    Expired: {summary.expired.map((item) => item.documentName).join(", ") || "None"}.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-[1fr_220px_180px]">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search documents"
                  className="pl-9"
                />
              </div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
                  {categories.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="EXPIRED">Expired</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              {loading && <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">Loading documents...</div>}
              {!loading && visibleCatalog.map((group) => (
                <section key={group.category} className="rounded-xl border bg-card p-4 shadow-sm">
                  <h2 className="text-base font-semibold text-slate-900">{group.category}</h2>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {group.documents.map((item) => {
                      const uploaded = documentByKey.get(item.key);
                      return (
                        <div key={item.key} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-medium text-slate-900">{item.name}</h3>
                                {item.mandatory && <Badge variant="outline">Mandatory</Badge>}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {uploaded ? `${uploaded.fileName} • ${formatFileSize(uploaded.fileSize)}` : "Pending upload"}
                              </p>
                            </div>
                            {uploaded ? getStatusBadge(uploaded.status) : <Badge variant="secondary">Pending</Badge>}
                          </div>

                          {uploaded && (
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                              <p>Number: <span className="font-medium">{uploaded.documentNumber || "-"}</span></p>
                              <p>Expiry: <span className="font-medium">{formatDate(uploaded.expiryDate)}</span></p>
                              <p>Uploaded: <span className="font-medium">{formatDate(uploaded.uploadedAt)}</span></p>
                              <p>Type: <span className="font-medium">{uploaded.fileType}</span></p>
                            </div>
                          )}

                          {uploaded?.remarks && <p className="mt-3 text-xs text-muted-foreground">{uploaded.remarks}</p>}

                          {uploaded?.uploadHistory?.length ? (
                            <div className="mt-3 rounded-md bg-white px-3 py-2 text-xs text-slate-600">
                              History: {uploaded.uploadHistory.slice(-3).map((entry) => `${entry.action} ${formatDate(entry.uploadedAt)}`).join(" • ")}
                            </div>
                          ) : null}

                          <div className="mt-4 flex flex-wrap gap-2">
                            {uploaded && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => openPreview(uploaded)}>
                                  <Eye className="mr-2 h-4 w-4" /> Preview
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => downloadDocument(uploaded)}>
                                  <Download className="mr-2 h-4 w-4" /> Download
                                </Button>
                              </>
                            )}
                            {canManage && (
                              <Button size="sm" onClick={() => openUpload(item.key)}>
                                <UploadCloud className="mr-2 h-4 w-4" /> {uploaded ? "Replace" : "Upload"}
                              </Button>
                            )}
                            {canManage && uploaded && (
                              <Button size="sm" variant="destructive" onClick={() => deleteDocument(uploaded)}>
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <aside className="space-y-5">
              <section className="rounded-xl border bg-card p-4 shadow-sm">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  Missing Documents
                </h2>
                <div className="mt-3 space-y-2">
                  {summary.missingMandatory.length === 0 && (
                    <p className="flex items-center gap-2 text-sm text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" /> Mandatory documents are complete.
                    </p>
                  )}
                  {summary.missingMandatory.map((item) => (
                    <div key={item.key} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                      {item.name}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border bg-card p-4 shadow-sm">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <AlertTriangle className="h-4 w-4 text-indigo-600" />
                  Expiring Soon
                </h2>
                <div className="mt-3 space-y-2">
                  {summary.expiringSoon.length === 0 && <p className="text-sm text-muted-foreground">No documents expiring in the next 30 days.</p>}
                  {summary.expiringSoon.map((item) => (
                    <div key={item._id} className="rounded-md border px-3 py-2 text-sm">
                      <p className="font-medium">{item.documentName}</p>
                      <p className="text-xs text-muted-foreground">Expires {formatDate(item.expiryDate)}</p>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Upload Organization Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div
              className={cn(
                "flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-slate-50 p-6 text-center transition-colors",
                dragging && "border-indigo-500 bg-indigo-50"
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                pickFile(event.dataTransfer.files?.[0] || null);
              }}
            >
              <UploadCloud className="h-8 w-8 text-slate-500" />
              <p className="mt-2 text-sm font-medium">{form.file ? form.file.name : "Drop file or browse"}</p>
              <p className="text-xs text-muted-foreground">PDF, JPG, PNG, DOCX up to 8MB</p>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.docx"
                onChange={(event) => pickFile(event.target.files?.[0] || null)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Document Number</label>
                <Input value={form.documentNumber} onChange={(event) => setForm((prev) => ({ ...prev, documentNumber: event.target.value }))} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Expiry Date</label>
                <Input type="date" value={form.expiryDate} onChange={(event) => setForm((prev) => ({ ...prev, expiryDate: event.target.value }))} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Remarks</label>
              <Textarea value={form.remarks} onChange={(event) => setForm((prev) => ({ ...prev, remarks: event.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitUpload} disabled={uploading || !form.file}>
              {uploading ? "Uploading..." : "Save Document"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default OrganizationDocuments;
