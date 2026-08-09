import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Edit, Eye, EyeOff, UserCheck, UserX } from "lucide-react";
import { getApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { formatDateInOrgTimeZone } from "@/utils/timezone";
import { useAuth } from "@/context/useAuth";

const ADMIN_STATUS_ROLE_SLUGS = new Set(["admin", "org-admin", "orgadmin", "super_admin", "superadmin"]);

const isEmployeeInactive = (employee: any) =>
  Boolean(employee?.isDeleted) ||
  employee?.status === "resigned" ||
  employee?.employmentLifecycleStatus === "terminated";

const getStatusBadge = (status: string, isDeleted = false) => {
  if (isDeleted) {
    return <Badge className="status-badge status-inactive">Inactive</Badge>;
  }
  switch (status) {
    case "active":
      return <Badge className="status-badge status-active">Active</Badge>;
    case "on_leave":
      return <Badge className="status-badge status-pending">On Leave</Badge>;
    case "resigned":
      return <Badge className="status-badge status-inactive">Inactive</Badge>;
    default:
      return <Badge variant="secondary">{status || "-"}</Badge>;
  }
};

const getLifecycleBadge = (status: string) => {
  const normalizedStatus = status || "confirmed";
  switch (normalizedStatus) {
    case "probation":
      return <Badge className="status-badge status-pending">Probation</Badge>;
    case "confirmed":
      return <Badge className="status-badge status-active">Confirmed</Badge>;
    case "notice":
      return <Badge className="status-badge status-inactive">Notice</Badge>;
    case "terminated":
      return <Badge className="status-badge status-inactive">Terminated</Badge>;
    default:
      return <Badge variant="secondary">{normalizedStatus}</Badge>;
  }
};

const formatDate = (value?: string) =>
  value ? formatDateInOrgTimeZone(value) : "-";

const formatAddress = (address: any) => {
  if (!address) return "-";
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.country,
    address.zip,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "-";
};

const maskValue = (value?: string, visibleTail = 4) => {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.length <= visibleTail) return "*".repeat(text.length);
  return `${"*".repeat(Math.max(4, text.length - visibleTail))}${text.slice(-visibleTail)}`;
};

const maskEmail = (value?: string) => {
  const text = String(value || "").trim();
  if (!text || !text.includes("@")) return "-";
  const [localPart, domain] = text.split("@");
  const visibleLocal = localPart.slice(0, 2);
  return `${visibleLocal}${"*".repeat(Math.max(3, localPart.length - 2))}@${domain}`;
};

const SensitiveValue = ({
  value,
  isEmail = false,
  visible = false
}: {
  value?: string;
  isEmail?: boolean;
  visible?: boolean;
}) => {
  const hasValue = Boolean(String(value || "").trim());
  const displayValue = visible
    ? String(value || "-")
    : isEmail
      ? maskEmail(value)
      : maskValue(value);

  return (
    <p>{hasValue ? displayValue : "-"}</p>
  );
};

const ID_CARD_FRONT_SKELETON = (import.meta as any).env?.VITE_IDCARD_FRONT_SKELETON || "/idcard_front.jpg";
const ID_CARD_BACK_SKELETON = (import.meta as any).env?.VITE_IDCARD_BACK_SKELETON || "/idcard_back.jpg";
const ID_CARD_INFO_ROW_NUDGES = [2.5, 1.5, 1, -1];
const ID_CARD_NAME_MAX_LETTERS = 15;

const countLetters = (value: string) => value.replace(/[^A-Za-z]/g, "").length;

const takeWordsWithinLetterLimit = (value: string, maxLetters: number) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const keptWords: string[] = [];
  let used = 0;
  for (const word of words) {
    const letters = countLetters(word);
    if (used + letters > maxLetters) break;
    keptWords.push(word);
    used += letters;
  }
  if (keptWords.length) return keptWords.join(" ");
  const compact = value.replace(/\s+/g, "");
  return compact.slice(0, maxLetters);
};

const formatIdCardName = (firstName?: string, lastName?: string) => {
  const first = (firstName || "").trim();
  const last = (lastName || "").trim();
  const full = `${first} ${last}`.trim();
  if (!full) return "Employee Name";
  if (countLetters(full) <= ID_CARD_NAME_MAX_LETTERS) return full;

  const firstWithinLimit = takeWordsWithinLetterLimit(first, ID_CARD_NAME_MAX_LETTERS);
  const firstLetters = countLetters(firstWithinLimit);
  const lastInitial = last.charAt(0);
  if (!lastInitial) return firstWithinLimit || "Employee Name";
  if (firstLetters + 1 > ID_CARD_NAME_MAX_LETTERS) return firstWithinLimit || "Employee Name";
  return `${firstWithinLimit} ${lastInitial}`.trim();
};

const ViewEmployee = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { profile, isSuperAdmin, hasAnyPermission } = useAuth();
  const [employee, setEmployee] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [idCardSide, setIdCardSide] = useState<"front" | "back">("front");
  const [exportingBothPdf, setExportingBothPdf] = useState(false);
  const [showIdCardSensitive, setShowIdCardSensitive] = useState(false);
  const [showWorkSensitive, setShowWorkSensitive] = useState(false);
  const [showPersonalSensitive, setShowPersonalSensitive] = useState(false);
  const idCardRef = useRef<HTMLDivElement | null>(null);
  const activeRoleSlug = String(profile?.activeRole?.slug || "").toLowerCase();
  const canManageEmployeeStatus =
    hasAnyPermission(["EMP_UPDATE"]) &&
    (isSuperAdmin || ADMIN_STATUS_ROLE_SLUGS.has(activeRoleSlug));

  const fetchEmployee = async () => {
    if (!id) return;
    setLoading(true);
    const res = await getApiWithToken(`/employees/${id}`);
    setLoading(false);

    if (res?.success) {
      setEmployee(res?.data);
    } else {
      toast.error(res?.message || "Failed to load employee");
    }
  };

  useEffect(() => {
    fetchEmployee();
  }, [id]);

  const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      image.src = src;
    });

  const waitForCardRender = async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  };

  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const getCanvasSafeImageSrc = async (src: string) => {
    if (!src) return "";
    if (src.startsWith("data:")) return src;
    try {
      const response = await fetch(src, { mode: "cors" });
      if (!response.ok) throw new Error("image fetch failed");
      const blob = await response.blob();
      return await blobToDataUrl(blob);
    } catch (_) {
      try {
        const resolved = new URL(src, window.location.href);
        if (resolved.origin === window.location.origin) return resolved.toString();
      } catch (_) {
        if (src.startsWith("/")) return src;
      }
      return "";
    }
  };

  const applyTextTransform = (text: string, transform: string) => {
    if (transform === "uppercase") return text.toUpperCase();
    if (transform === "lowercase") return text.toLowerCase();
    if (transform === "capitalize") return text.replace(/\b\w/g, (c) => c.toUpperCase());
    return text;
  };

  const drawTextFromElement = (
    ctx: CanvasRenderingContext2D,
    element: HTMLElement,
    cardRect: DOMRect,
    options?: { yTopOverride?: number; yNudge?: number }
  ) => {
    const elementRect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const rawText = (element.textContent || "").trim();
    const text = applyTextTransform(rawText, style.textTransform);
    if (!text) return;

    const fontSize = style.fontSize || "14px";
    const fontWeight = style.fontWeight || "400";
    const fontFamily = style.fontFamily || "Arial, sans-serif";
    const xLeft = elementRect.left - cardRect.left;
    const yTop = (options?.yTopOverride ?? (elementRect.top - cardRect.top)) + (options?.yNudge ?? 0);
    const yCenter = yTop + (elementRect.height / 2);
    const width = elementRect.width;
    const textAlign = style.textAlign as CanvasTextAlign;

    ctx.fillStyle = style.color || "#0a4874";
    ctx.font = `${fontWeight} ${fontSize} ${fontFamily}`;
    ctx.textBaseline = "middle";
    if (textAlign === "center") {
      ctx.textAlign = "center";
      ctx.fillText(text, xLeft + width / 2, yCenter, width);
      return;
    }
    if (textAlign === "right" || textAlign === "end") {
      ctx.textAlign = "right";
      ctx.fillText(text, xLeft + width, yCenter, width);
      return;
    }
    ctx.textAlign = "left";
    ctx.fillText(text, xLeft, yCenter, width);
  };

  const captureIdCardPngDataUrl = async (side: "front" | "back" = idCardSide) => {
    const cardNode = idCardRef.current;
    if (!cardNode) throw new Error("ID card not found");

    const rect = cardNode.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));
    const scale = 2;

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    ctx.scale(scale, scale);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    const templateSrc = side === "front" ? ID_CARD_FRONT_SKELETON : ID_CARD_BACK_SKELETON;
    const templateImageSrc = await getCanvasSafeImageSrc(templateSrc);
    if (!templateImageSrc) throw new Error("Card template image unavailable");
    const templateImage = await loadImage(templateImageSrc);
    ctx.drawImage(templateImage, 0, 0, width, height);

    if (side === "front") {
      const cardRect = cardNode.getBoundingClientRect();
      const profileSrc = employee?.profileImage || "";
      const profileImageSrc = await getCanvasSafeImageSrc(profileSrc);
      if (profileImageSrc) {
        const profileImage = await loadImage(profileImageSrc);
        const px = width * 0.222;
        const py = height * 0.243;
        const pw = width * 0.512;
        const ph = height * 0.372;
        ctx.drawImage(profileImage, px, py, pw, ph);
      }

      const nameEl = cardNode.querySelector("[data-idcard-name]") as HTMLElement | null;
      const designationEl = cardNode.querySelector("[data-idcard-designation]") as HTMLElement | null;
      const infoEls = Array.from(cardNode.querySelectorAll("[data-idcard-info]")) as HTMLElement[];

      if (nameEl) drawTextFromElement(ctx, nameEl, cardRect);
      if (designationEl) drawTextFromElement(ctx, designationEl, cardRect);
      if (infoEls.length > 0) {
        const firstTop = infoEls[0].getBoundingClientRect().top - cardRect.top;
        const secondTop = infoEls[1]
          ? infoEls[1].getBoundingClientRect().top - cardRect.top
          : firstTop + infoEls[0].getBoundingClientRect().height;
        const step = secondTop - firstTop;
        infoEls.forEach((el, idx) => {
          drawTextFromElement(ctx, el, cardRect, {
            yTopOverride: firstTop + idx * step,
            yNudge: ID_CARD_INFO_ROW_NUDGES[idx] ?? 0
          });
        });
      }
    }

    return canvas.toDataURL("image/png");
  };

  const downloadIdCardPng = async () => {
    try {
      const pngDataUrl = await captureIdCardPngDataUrl(idCardSide);
      const link = document.createElement("a");
      link.href = pngDataUrl;
      link.download = `${(employee?.employeeCode || "employee-id-card").toLowerCase()}-${idCardSide}.png`;
      link.click();
      toast.success("ID card PNG downloaded");
    } catch {
      toast.error("Unable to download PNG for this card");
    }
  };

  const dataUrlToBytes = async (dataUrl: string) => {
    const response = await fetch(dataUrl);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  };

  const pngToJpegPage = async (pngDataUrl: string) => {
    const img = new Image();
    img.decoding = "async";
    img.src = pngDataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image decode failed"));
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const jpegBytes = await dataUrlToBytes(jpegDataUrl);
    return {
      width: canvas.width,
      height: canvas.height,
      jpegBytes
    };
  };

  const encodeText = (text: string) => {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
    return bytes;
  };

  const buildPdfBlobFromJpegPages = (pages: Array<{ width: number; height: number; jpegBytes: Uint8Array }>) => {
    const chunks: Uint8Array[] = [];
    const xrefOffsets: number[] = [0];
    let offset = 0;
    const pushChunk = (chunk: Uint8Array) => {
      chunks.push(chunk);
      offset += chunk.length;
    };
    const pushText = (text: string) => pushChunk(encodeText(text));
    const addObject = (objId: number, content: Uint8Array | string) => {
      xrefOffsets[objId] = offset;
      pushText(`${objId} 0 obj\n`);
      if (typeof content === "string") pushText(content);
      else pushChunk(content);
      pushText(`\nendobj\n`);
    };

    pushText("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    const pageCount = pages.length;
    const catalogObjId = 1;
    const pagesObjId = 2;
    const firstPageObjId = 3;
    const firstContentObjId = firstPageObjId + pageCount;
    const firstImageObjId = firstContentObjId + pageCount;

    const kids = Array.from({ length: pageCount }, (_, i) => `${firstPageObjId + i} 0 R`).join(" ");
    addObject(catalogObjId, `<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);
    addObject(pagesObjId, `<< /Type /Pages /Kids [ ${kids} ] /Count ${pageCount} >>`);

    const pageWidthPt = 595.28;
    const pageHeightPt = 841.89;
    const marginPt = 24;
    const maxDrawWidth = pageWidthPt - marginPt * 2;
    const maxDrawHeight = pageHeightPt - marginPt * 2;

    pages.forEach((page, index) => {
      const pageObjId = firstPageObjId + index;
      const contentObjId = firstContentObjId + index;
      const imageObjId = firstImageObjId + index;
      const scale = Math.min(maxDrawWidth / page.width, maxDrawHeight / page.height);
      const drawWidth = page.width * scale;
      const drawHeight = page.height * scale;
      const drawX = (pageWidthPt - drawWidth) / 2;
      const drawY = (pageHeightPt - drawHeight) / 2;

      const contentStream = `q\n${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${drawX.toFixed(3)} ${drawY.toFixed(3)} cm\n/Im${index + 1} Do\nQ\n`;
      addObject(pageObjId, `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${pageWidthPt} ${pageHeightPt}] /Resources << /XObject << /Im${index + 1} ${imageObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`);
      addObject(contentObjId, `<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream`);

      xrefOffsets[imageObjId] = offset;
      pushText(`${imageObjId} 0 obj\n`);
      pushText(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpegBytes.length} >>\nstream\n`);
      pushChunk(page.jpegBytes);
      pushText("\nendstream\nendobj\n");
    });

    const xrefStart = offset;
    const objectCount = firstImageObjId + pageCount - 1;
    pushText(`xref\n0 ${objectCount + 1}\n`);
    pushText("0000000000 65535 f \n");
    for (let objectId = 1; objectId <= objectCount; objectId += 1) {
      const value = (xrefOffsets[objectId] || 0).toString().padStart(10, "0");
      pushText(`${value} 00000 n \n`);
    }
    pushText(`trailer\n<< /Size ${objectCount + 1} /Root ${catalogObjId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    return new Blob(chunks as BlobPart[], { type: "application/pdf" });
  };

  const savePdfFromPngDataUrls = async (pages: Array<{ pngDataUrl: string }>, fileName: string) => {
    const jpegPages = await Promise.all(pages.map((page) => pngToJpegPage(page.pngDataUrl)));
    const pdfBlob = buildPdfBlobFromJpegPages(jpegPages);
    const blobUrl = URL.createObjectURL(pdfBlob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  };

  const downloadIdCardPdf = async () => {
    try {
      const pngDataUrl = await captureIdCardPngDataUrl(idCardSide);
      await savePdfFromPngDataUrls(
        [{ pngDataUrl }],
        `${(employee?.employeeCode || "employee-id-card").toLowerCase()}-${idCardSide}.pdf`
      );
      toast.success("ID card PDF downloaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("ID card PDF generation failed:", error);
      toast.error(`Unable to generate PDF for this card: ${message}`);
    }
  };

  const downloadBothSidesPdf = async () => {
    const previousSide = idCardSide;
    try {
      setExportingBothPdf(true);

      setIdCardSide("front");
      await waitForCardRender();
      const frontPng = await captureIdCardPngDataUrl("front");

      setIdCardSide("back");
      await waitForCardRender();
      const backPng = await captureIdCardPngDataUrl("back");

      setIdCardSide(previousSide);
      await waitForCardRender();
      await savePdfFromPngDataUrls(
        [{ pngDataUrl: frontPng }, { pngDataUrl: backPng }],
        `${(employee?.employeeCode || "employee-id-card").toLowerCase()}-both-sides.pdf`
      );
      toast.success("Both sides PDF downloaded");
    } catch (error) {
      setIdCardSide(previousSide);
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Both sides PDF generation failed:", error);
      toast.error(`Unable to generate both sides PDF: ${message}`);
    } finally {
      setExportingBothPdf(false);
    }
  };

  const confirmStatusChange = async () => {
    if (!employee?._id) return;
    if (!canManageEmployeeStatus) {
      toast.error("Only admin can activate or inactivate employees");
      return;
    }

    const nextStatus = isEmployeeInactive(employee) ? "active" : "resigned";
    const res = await putApiWithToken(`/employees/${employee._id}`, {
      status: nextStatus
    });
    if (res?.success) {
      toast.success(nextStatus === "active" ? "Employee marked active" : "Employee marked inactive");
      setEmployee((prev: any) =>
        prev
          ? {
              ...prev,
              status: nextStatus,
              isDeleted: false,
              employmentLifecycleStatus:
                nextStatus === "active" ? "confirmed" : prev.employmentLifecycleStatus
            }
          : prev
      );
    } else {
      toast.error(res?.message || "Status update failed");
    }
    setDeleteDialogOpen(false);
  };

  return (
    <MainLayout
      title="Employee Details"
      breadcrumb={[
        { label: "Home", href: "/" },
        { label: "Employees", href: "/employees" },
        { label: "View Employee" },
      ]}
    >
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <button
          onClick={() => navigate("/employees")}
          className="flex items-center gap-2 text-muted-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate(`/employees/edit/${employee?._id}`)}
            disabled={!employee}
          >
            <Edit className="w-4 h-4 mr-2" />
            Edit
          </Button>
          {canManageEmployeeStatus && (
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={!employee}
            >
              {isEmployeeInactive(employee) ? (
                <UserCheck className="w-4 h-4 mr-2" />
              ) : (
                <UserX className="w-4 h-4 mr-2" />
              )}
              {isEmployeeInactive(employee) ? "Mark Active" : "Mark Inactive"}
            </Button>
          )}
        </div>
      </div>

      {loading && (
        <div className="bg-card rounded-xl card-shadow p-6 text-center">
          Loading...
        </div>
      )}

      {!loading && employee && (
        <>
          <div className="bg-card rounded-xl card-shadow p-6 mb-6 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14">
                <AvatarImage src={employee.profileImage || ""} />
                <AvatarFallback>
                  {`${employee.firstName?.[0] || ""}${employee.lastName?.[0] || ""}`}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-lg font-semibold">
                  {employee.firstName} {employee.lastName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {employee.employeeCode || "-"}
                </p>
              </div>
            </div>
            <div>{getStatusBadge(employee.status, Boolean(employee.isDeleted))}</div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="stat-card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Work Information</h3>
              </div>
              <div className="relative">
                {!showWorkSensitive && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/45 backdrop-blur-sm">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-11 w-11 rounded-full bg-white/90 shadow-sm"
                      onClick={() => setShowWorkSensitive(true)}
                    >
                      <Eye className="w-5 h-5" />
                    </Button>
                  </div>
                )}
                {showWorkSensitive && (
                  <div className="absolute right-0 top-0 z-10">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => setShowWorkSensitive(false)}
                    >
                      <EyeOff className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm transition ${!showWorkSensitive ? "blur-[3px]" : ""}`}>
                <div>
                  <p className="text-muted-foreground">Email</p>
                  <SensitiveValue value={employee.userId?.email} isEmail visible={showWorkSensitive} />
                </div>
                <div>
                  <p className="text-muted-foreground">Phone</p>
                  <SensitiveValue value={employee.phone} visible={showWorkSensitive} />
                </div>
                <div>
                  <p className="text-muted-foreground">Department</p>
                  <p>{employee.departmentId?.name || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Designation</p>
                  <p>{employee.designationId?.name || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Role</p>
                  <p>
                    {employee.roleIds?.length
                      ? employee.roleIds
                          .map((role: any) => role?.name || role)
                          .join(", ")
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Manager</p>
                  <p>
                    {employee.managerId
                      ? `${employee.managerId?.firstName || ""} ${employee.managerId?.lastName || ""}`.trim()
                      : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Employment Type</p>
                  <p>{employee.employmentType || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Join Date</p>
                  <p>{formatDate(employee.dateOfJoining)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <p>{employee.status || "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Lifecycle</p>
                  <div className="mt-1">{getLifecycleBadge(employee.employmentLifecycleStatus)}</div>
                </div>
                <div>
                  <p className="text-muted-foreground">Benefits Eligible</p>
                  <p>{employee.benefitsEligible ? "Yes" : "No"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Probation End Date</p>
                  <p>{formatDate(employee.probationEndDate)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Confirmed Date</p>
                  <p>{formatDate(employee.confirmedDate || employee.probationCompletedAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last Working Day</p>
                  <p>{formatDate(employee.lastWorkingDay || employee.noticeEndDate)}</p>
                </div>
                </div>
              </div>
            </div>

            <div className="stat-card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Personal Information</h3>
              </div>
              <div className="relative">
                {!showPersonalSensitive && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/45 backdrop-blur-sm">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-11 w-11 rounded-full bg-white/90 shadow-sm"
                      onClick={() => setShowPersonalSensitive(true)}
                    >
                      <Eye className="w-5 h-5" />
                    </Button>
                  </div>
                )}
                {showPersonalSensitive && (
                  <div className="absolute right-0 top-0 z-10">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => setShowPersonalSensitive(false)}
                    >
                      <EyeOff className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm transition ${!showPersonalSensitive ? "blur-[3px]" : ""}`}>
                <div>
                  <p className="text-muted-foreground">Date of Birth</p>
                  <SensitiveValue value={employee.dob ? formatDate(employee.dob) : "-"} visible={showPersonalSensitive} />
                </div>
                <div>
                  <p className="text-muted-foreground">Gender</p>
                  <p>{employee.gender || "-"}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-muted-foreground">Address</p>
                  <SensitiveValue value={formatAddress(employee.address)} visible={showPersonalSensitive} />
                </div>
                </div>
              </div>
            </div>

            <div className="stat-card space-y-3 lg:col-span-2">
              <h3 className="text-base font-semibold">Emergency Contacts</h3>
              {employee.emergencyContacts?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {employee.emergencyContacts.map((contact: any, index: number) => (
                    <div key={`${contact.phone}-${index}`} className="border rounded-lg p-3">
                      <p className="font-medium">{contact.name}</p>
                      <p className="text-muted-foreground">{contact.relation}</p>
                      <SensitiveValue value={contact.phone} visible={showPersonalSensitive} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No emergency contacts</p>
              )}
            </div>

            <div className="stat-card space-y-4 lg:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">Employee ID Card</h3>
                  <p className="text-sm text-muted-foreground">Admin preview of employee digital ID card</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                  <div className="inline-flex rounded-lg border p-1 bg-muted/40">
                    <Button
                      size="sm"
                      variant={idCardSide === "front" ? "default" : "ghost"}
                      onClick={() => setIdCardSide("front")}
                    >
                      Front
                    </Button>
                    <Button
                      size="sm"
                      variant={idCardSide === "back" ? "default" : "ghost"}
                      onClick={() => setIdCardSide("back")}
                    >
                      Back
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowIdCardSensitive((prev) => !prev)}
                  >
                    {showIdCardSensitive ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                    {showIdCardSensitive ? "Hide Sensitive" : "Show Sensitive"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={downloadIdCardPng}>Download PNG</Button>
                  <Button size="sm" onClick={downloadIdCardPdf}>Download PDF</Button>
                  <Button size="sm" variant="secondary" onClick={downloadBothSidesPdf} disabled={exportingBothPdf}>
                    {exportingBothPdf ? "Preparing..." : "Both Sides PDF"}
                  </Button>
                </div>
              </div>

              <div className="mx-auto max-w-[390px]">
                <div ref={idCardRef} className="relative overflow-hidden rounded-[18px] border-[4px] border-[#0f4a79] bg-[#edf2f8] w-[360px] h-[604px]">
                  <img
                    src={idCardSide === "front" ? ID_CARD_FRONT_SKELETON : ID_CARD_BACK_SKELETON}
                    alt={idCardSide === "front" ? "ID card front skeleton" : "ID card back skeleton"}
                    className="absolute inset-0 w-full h-full object-cover"
                  />

                  <div className="relative z-10 h-full">
                    {idCardSide === "front" ? (
                      <>
                        {employee?.profileImage && (
                          <div className="absolute left-[22.2%] top-[24.3%] w-[51.2%] h-[37.2%] overflow-hidden">
                            <img
                              src={employee.profileImage}
                              alt="ID profile"
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}

                        <div className="absolute left-[8%] right-[8%] top-[64.9%] text-center">
                          <p data-idcard-name className="text-[#0a4874] text-[17px] sm:text-[19px] font-extrabold uppercase tracking-[0.6px] leading-tight">
                            {formatIdCardName(employee?.firstName, employee?.lastName)}
                          </p>
                          <p data-idcard-designation className="text-[#0a4874] text-[13px] sm:text-[14px] font-bold uppercase mt-1 leading-tight">
                            {employee?.designationId?.name || "Designation"}
                          </p>
                        </div>

                        <div className="absolute left-[53.2%] top-[75.2%] text-[#0a4874] text-[12px] sm:text-[13px] font-medium leading-[1.78]">
                          <p data-idcard-info>{employee?.employeeCode || "-"}</p>
                          <p data-idcard-info>{showIdCardSensitive ? (employee?.phone || "-") : maskValue(employee?.phone)}</p>
                          <p data-idcard-info>{showIdCardSensitive ? (employee?.emergencyContacts?.[0]?.phone || "-") : maskValue(employee?.emergencyContacts?.[0]?.phone)}</p>
                          <p data-idcard-info>{showIdCardSensitive ? (employee?.bloodGroup || "-") : maskValue(employee?.bloodGroup, 1)}</p>
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isEmployeeInactive(employee) ? "Mark Employee Active" : "Mark Employee Inactive"}
            </DialogTitle>
            <DialogDescription>
              {isEmployeeInactive(employee)
                ? "This employee will become active again."
                : "This employee will be marked inactive instead of being deleted."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmStatusChange}>
              {isEmployeeInactive(employee) ? "Mark Active" : "Mark Inactive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default ViewEmployee;
