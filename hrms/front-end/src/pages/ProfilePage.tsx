import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { hasPermission } from "@/utils/auth";
import { useAuth } from "@/context/useAuth";
import { PageLoader } from "@/components/ui/loaders";
import { formatDateInOrgTimeZone } from "@/utils/timezone";

const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const ADDRESS_PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ADDRESS_PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const RELATION_OPTIONS = [
  { label: "Father", value: "father" },
  { label: "Mother", value: "mother" },
  { label: "Spouse", value: "spouse" },
  { label: "Brother", value: "brother" },
  { label: "Sister", value: "sister" },
  { label: "Son", value: "son" },
  { label: "Daughter", value: "daughter" },
  { label: "Guardian", value: "guardian" },
  { label: "Friend", value: "friend" },
  { label: "Other", value: "other" }
];
const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const ID_CARD_FRONT_SKELETON = (import.meta as any).env?.VITE_IDCARD_FRONT_SKELETON || "/idcard_front.jpg";
const ID_CARD_BACK_SKELETON = (import.meta as any).env?.VITE_IDCARD_BACK_SKELETON || "/idcard_back.jpg";
const ID_CARD_INFO_ROW_NUDGES = [2.5, 1.5, 1, -1];
const ID_CARD_NAME_MAX_LETTERS = 15;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const sanitizePlaceName = (value: string) => value.replace(/[^A-Za-z .'-]/g, "");
const isValidPlaceName = (value: string) => /^[A-Za-z]+(?:[A-Za-z .'-]*[A-Za-z])?$/.test(value.trim());

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

const buildProfileFormState = (profile: any) => ({
  phone: profile?.phone || "",
  dob: profile?.dob ? new Date(profile.dob).toISOString().slice(0, 10) : "",
  gender: profile?.gender || "",
  bloodGroup: profile?.bloodGroup || "",
  address: profile?.address || {
    line1: "",
    line2: "",
    city: "",
    state: "",
    country: "",
    zip: ""
  },
  emergencyContacts: profile?.emergencyContacts?.length
    ? profile.emergencyContacts
    : [{ name: "", relation: "", phone: "" }],
  profileImageUpload: null,
  addressProofUpload: null
});

const ProfilePage = () => {
  const { loadProfile } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const canEdit = hasPermission("EMP_SELF_EDIT");
  const [idCardSide, setIdCardSide] = useState<"front" | "back">("front");
  const idCardRef = useRef<HTMLDivElement | null>(null);
  const [exportingBothPdf, setExportingBothPdf] = useState(false);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState("");
  const [profilePicInputKey, setProfilePicInputKey] = useState(0);

  const [form, setForm] = useState({
    phone: "",
    dob: "",
    gender: "",
    bloodGroup: "",
    address: {
      line1: "",
      line2: "",
      city: "",
      state: "",
      country: "",
      zip: ""
    },
    emergencyContacts: [
      { name: "", relation: "", phone: "" }
    ],
    profileImageUpload: null as null | { fileName: string; mimeType: string; base64Data: string },
    addressProofUpload: null as null | { fileName: string; mimeType: string; base64Data: string }
  });

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

  const validateFile = (file: File, allowedTypes: string[], maxBytes: number, label: string) => {
    if (!allowedTypes.includes(file.type)) {
      toast.error(`Invalid ${label} format`);
      return false;
    }
    if (file.size > maxBytes) {
      toast.error(`${label} size should be under ${Math.floor(maxBytes / (1024 * 1024))}MB`);
      return false;
    }
    return true;
  };

  const fetchProfile = async () => {
    setProfileLoading(true);
    const res = await getApiWithToken("/employees/me");
    if (res?.success) {
      setProfile(res.data);
      setForm(buildProfileFormState(res.data));
      setProfilePreviewUrl("");
      setProfilePicInputKey((v) => v + 1);
    }
    setProfileLoading(false);
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  if (profileLoading) {
    return (
      <MainLayout title="My Profile" breadcrumb={[{ label: "Home" }, { label: "Profile" }]}>
        <PageLoader label="Loading your profile..." />
      </MainLayout>
    );
  }

  const handleSave = async () => {
    if (form.phone.trim() && !INDIAN_MOBILE_REGEX.test(form.phone.trim())) {
      toast.error("Phone number must be a valid 10-digit Indian mobile number");
      return;
    }
    if (form.address?.zip?.trim() && !/^\d+$/.test(form.address.zip.trim())) {
      toast.error("PIN/Zip code must contain only numbers");
      return;
    }
    if (form.address.city.trim() && !isValidPlaceName(form.address.city)) {
      toast.error("City must contain only letters");
      return;
    }
    if (form.address.state.trim() && !isValidPlaceName(form.address.state)) {
      toast.error("State must contain only letters");
      return;
    }
    if (form.address.country.trim() && !isValidPlaceName(form.address.country)) {
      toast.error("Country must contain only letters");
      return;
    }

    const emergency = form.emergencyContacts[0];
    const hasEmergencyValue = Boolean(emergency?.name || emergency?.relation || emergency?.phone);
    if (hasEmergencyValue) {
      if (!emergency?.name || !emergency?.relation || !emergency?.phone) {
        toast.error("Complete all emergency contact fields");
        return;
      }
      if (!/^[A-Za-z ]{2,50}$/.test(emergency.name.trim())) {
        toast.error("Emergency contact name should contain only letters (2-50 chars)");
        return;
      }
      if (!INDIAN_MOBILE_REGEX.test(emergency.phone.trim())) {
        toast.error("Emergency contact mobile number must be a valid 10-digit Indian mobile number");
        return;
      }
    }

    setLoading(true);
    const payload = {
      phone: form.phone,
      dob: form.dob,
      gender: form.gender,
      bloodGroup: form.bloodGroup || undefined,
      address: form.address,
      emergencyContacts: form.emergencyContacts.filter((c) => c.name && c.relation && c.phone),
      profileImageUpload: form.profileImageUpload || undefined,
      addressProofUpload: form.addressProofUpload || undefined
    };

    const res = await putApiWithToken("/employees/me/profile", payload);
    setLoading(false);
    if (res?.success) {
      toast.success("Profile updated");
      setOpen(false);
      await fetchProfile();
      await loadProfile();
    } else {
      toast.error(res?.message || "Update failed");
    }
  };

  const handleCancelEdit = () => {
    setForm(buildProfileFormState(profile));
    setProfilePreviewUrl("");
    setProfilePicInputKey((v) => v + 1);
    setOpen(false);
  };

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
      const profileSrc = profilePreviewUrl || profile?.profileImage || "";
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
      link.download = `${(profile?.employeeCode || "employee-id-card").toLowerCase()}-${idCardSide}.png`;
      link.click();
      toast.success("ID card PNG downloaded");
    } catch (error) {
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
    for (let id = 1; id <= objectCount; id += 1) {
      const value = (xrefOffsets[id] || 0).toString().padStart(10, "0");
      pushText(`${value} 00000 n \n`);
    }
    pushText(`trailer\n<< /Size ${objectCount + 1} /Root ${catalogObjId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

    return new Blob(chunks as BlobPart[], { type: "application/pdf" });
  };

  const savePdfFromPngDataUrls = async (pages: Array<{ pngDataUrl: string }>, fileName: string) => {
    const jpegPages = await Promise.all(pages.map((p) => pngToJpegPage(p.pngDataUrl)));
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
        `${(profile?.employeeCode || "employee-id-card").toLowerCase()}-${idCardSide}.pdf`
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
        `${(profile?.employeeCode || "employee-id-card").toLowerCase()}-both-sides.pdf`
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

  return (
    <MainLayout title="My Profile" breadcrumb={[{ label: "Home" }, { label: "Profile" }]}>
      <div className="bg-card rounded-xl card-shadow p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">{profile?.firstName} {profile?.lastName}</h2>
            <p className="text-muted-foreground">{profile?.userId?.email}</p>
          </div>
          {(profilePreviewUrl || profile?.profileImage) && (
            <img
              src={profilePreviewUrl || profile?.profileImage}
              alt="Profile"
              className="h-14 w-14 rounded-full object-cover border"
            />
          )}
          <Button onClick={() => setOpen(true)} disabled={!canEdit}>Edit Profile</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl card-shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Employment Details</h3>
          <div className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Employee Code:</span> {profile?.employeeCode || "-"}</div>
            <div><span className="text-muted-foreground">Department:</span> {profile?.departmentId?.name || "-"}</div>
            <div><span className="text-muted-foreground">Designation:</span> {profile?.designationId?.name || "-"}</div>
            <div><span className="text-muted-foreground">Employment Type:</span> {profile?.employmentType || "-"}</div>
            <div><span className="text-muted-foreground">Date Of Joining:</span> {profile?.dateOfJoining ? formatDateInOrgTimeZone(profile.dateOfJoining) : "-"}</div>
            <div><span className="text-muted-foreground">Reporting Manager:</span> {profile?.managerId ? `${profile.managerId.firstName || ""} ${profile.managerId.lastName || ""}`.trim() : "-"}</div>
          </div>
        </div>

        <div className="bg-card rounded-xl card-shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Personal Details</h3>
          <div className="space-y-2 text-sm">
            <div><span className="text-muted-foreground">Work Email:</span> {profile?.userId?.email || "-"}</div>
            <div><span className="text-muted-foreground">Phone:</span> {profile?.phone || "-"}</div>
            <div><span className="text-muted-foreground">DOB:</span> {profile?.dob ? formatDateInOrgTimeZone(profile.dob) : "-"}</div>
            <div><span className="text-muted-foreground">Gender:</span> {profile?.gender || "-"}</div>
            <div><span className="text-muted-foreground">Blood Group:</span> {profile?.bloodGroup || "-"}</div>
            <div><span className="text-muted-foreground">Address:</span> {profile?.address?.line1 || "-"}</div>
            <div>
              <span className="text-muted-foreground">Address Proof:</span>{" "}
              {profile?.addressProof?.fileUrl ? (
                <a href={profile.addressProof.fileUrl} className="text-primary underline" target="_blank" rel="noreferrer">
                  View
                </a>
              ) : "-"}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card rounded-xl card-shadow p-6 mt-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold">Employee ID Card</h3>
            <p className="text-sm text-muted-foreground">Digital card for employee identification</p>
          </div>
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
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={downloadIdCardPng}>Download PNG</Button>
            <Button size="sm" onClick={downloadIdCardPdf}>Download PDF</Button>
            <Button size="sm" variant="secondary" onClick={downloadBothSidesPdf} disabled={exportingBothPdf}>
              {exportingBothPdf ? "Preparing..." : "Download Both Sides PDF"}
            </Button>
          </div>
        </div>

        <div className="mx-auto max-w-[390px]">
          <div
            ref={idCardRef}
            className="relative overflow-hidden rounded-[18px] border-[4px] border-[#0f4a79] bg-[#edf2f8] w-[360px] h-[604px]"
          >
            <img
              src={idCardSide === "front" ? ID_CARD_FRONT_SKELETON : ID_CARD_BACK_SKELETON}
              alt={idCardSide === "front" ? "ID card front skeleton" : "ID card back skeleton"}
              className="absolute inset-0 w-full h-full object-cover"
            />

            <div className="relative z-10 h-full">
              {idCardSide === "front" ? (
                <>
                  {(profilePreviewUrl || profile?.profileImage) && (
                    <div className="absolute left-[22.2%] top-[24.3%] w-[51.2%] h-[37.2%] overflow-hidden">
                      <img
                        src={profilePreviewUrl || profile?.profileImage}
                        alt="ID profile"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <div className="absolute left-[10%] right-[10%] top-[64.5%] h-[11%] rounded-sm" />
                  <div className="absolute left-[8%] right-[8%] top-[64.9%] text-center">
                    <p data-idcard-name className="text-[#0a4874] text-[17px] sm:text-[19px] font-extrabold uppercase tracking-[0.6px] leading-tight">
                      {formatIdCardName(profile?.firstName, profile?.lastName)}
                    </p>
                    <p data-idcard-designation className="text-[#0a4874] text-[13px] sm:text-[14px] font-bold uppercase mt-1 leading-tight">
                      {profile?.designationId?.name || "Designation"}
                    </p>
                  </div>

                  <div className="absolute left-[50.5%] right-[8%] top-[75.2%] h-[13.5%] rounded-sm" />
                  <div className="absolute left-[53.2%] top-[75.2%] text-[#0a4874] text-[12px] sm:text-[13px] font-medium leading-[1.78]">
                    {[
                      profile?.employeeCode || "-",
                      profile?.phone || "-",
                      profile?.emergencyContacts?.[0]?.phone || "-",
                      profile?.bloodGroup || "-"
                    ].map((value, idx) => (
                      <p
                        key={`idcard-info-${idx}`}
                        data-idcard-info
                        style={{ transform: `translateY(${ID_CARD_INFO_ROW_NUDGES[idx] ?? 0}px)` }}
                      >
                        {value}
                      </p>
                    ))}
                  </div>

                </>
              ) : (
                <></>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            handleCancelEdit();
            return;
          }
          setOpen(true);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto border-slate-200 bg-white p-0 shadow-2xl sm:max-w-4xl">
          <DialogHeader className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-6 py-5">
            <DialogTitle className="text-xl font-semibold text-slate-900">Edit Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 px-6 py-6">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
              <Label className="mb-2 block">Profile Picture</Label>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
                <div className="flex items-center gap-4">
                  <label
                    htmlFor="profile-picture-upload"
                    className="relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white text-center shadow-sm transition hover:border-slate-300 hover:shadow md:h-28 md:w-28"
                    aria-label="Click profile picture to update"
                  >
                    {(profilePreviewUrl || profile?.profileImage) ? (
                      <img
                        src={profilePreviewUrl || profile?.profileImage}
                        alt="Profile preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="px-3 text-sm font-medium text-slate-500">Upload</span>
                    )}
                  </label>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-slate-900">
                      {`${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() || "Employee"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Employee ID: <span className="font-medium text-slate-700">{profile?.employeeCode || "-"}</span>
                    </p>
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <Input
                    id="profile-picture-upload"
                    key={profilePicInputKey}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="Choose profile picture file"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (!validateFile(file, PROFILE_IMAGE_TYPES, PROFILE_IMAGE_MAX_BYTES, "Profile image")) return;
                      const base64Data = await fileToBase64(file);
                      setProfilePreviewUrl(URL.createObjectURL(file));
                      setForm({
                        ...form,
                        profileImageUpload: {
                          fileName: file.name,
                          mimeType: file.type,
                          base64Data
                        }
                      });
                    }}
                  />
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    Click on the profile picture to update. JPG, PNG, WEBP up to 2MB
                  </p>
                  {form.profileImageUpload?.fileName && (
                    <p className="text-xs text-muted-foreground">{form.profileImageUpload.fileName}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-900">Personal Details</h3>
                <p className="text-sm text-slate-500">Keep your profile information accurate and easy to identify.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label className="mb-2 block">Phone Number</Label>
                  <Input
                    placeholder="Phone"
                    validationType="phone"
                    inputMode="numeric"
                    maxLength={10}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="mb-2 block">DOB (Date of Birth)</Label>
                  <Input
                    type="date"
                    placeholder="DOB"
                    value={form.dob}
                    onChange={(e) => setForm({ ...form, dob: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="mb-2 block">Gender</Label>
                  <Select value={form.gender} onValueChange={(value) => setForm({ ...form, gender: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-2 block">Blood Group</Label>
                  <Select
                    value={form.bloodGroup || ""}
                    onValueChange={(value) => setForm({ ...form, bloodGroup: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Blood Group (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {BLOOD_GROUP_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-900">Address Details</h3>
                <p className="text-sm text-slate-500">Add your current address and supporting proof in one place.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label className="mb-2 block">Address Line 1</Label>
                  <Input
                    placeholder="Address Line 1"
                    value={form.address.line1}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, line1: e.target.value } })}
                  />
                </div>
                <div>
                  <Label className="mb-2 block">City</Label>
                  <Input
                    placeholder="City"
                    value={form.address.city}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, city: sanitizePlaceName(e.target.value) } })}
                  />
                </div>
                <div>
                  <Label className="mb-2 block">State</Label>
                  <Input
                    placeholder="State"
                    value={form.address.state}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, state: sanitizePlaceName(e.target.value) } })}
                  />
                </div>
                <div>
                  <Label className="mb-2 block">Country</Label>
                  <Input
                    placeholder="Country"
                    value={form.address.country}
                    onChange={(e) => setForm({ ...form, address: { ...form.address, country: sanitizePlaceName(e.target.value) } })}
                  />
                </div>
                <div>
                  <Label className="mb-2 block">Zip Code</Label>
                  <Input
                    placeholder="Zip"
                    value={form.address.zip}
                    inputMode="numeric"
                    onChange={(e) => setForm({
                      ...form,
                      address: { ...form.address, zip: e.target.value.replace(/\D/g, "") }
                    })}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label className="mb-2 block">Address Proof</Label>
                  <Input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp"
                    aria-label="Choose address proof file"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (!validateFile(file, ADDRESS_PROOF_TYPES, ADDRESS_PROOF_MAX_BYTES, "Address proof")) return;
                      const base64Data = await fileToBase64(file);
                      setForm({
                        ...form,
                        addressProofUpload: {
                          fileName: file.name,
                          mimeType: file.type,
                          base64Data
                        }
                      });
                    }}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Choose address proof file. PDF, JPG, PNG, WEBP up to 5MB
                  </p>
                  {form.addressProofUpload?.fileName && (
                    <p className="mt-1 text-xs text-muted-foreground">{form.addressProofUpload.fileName}</p>
                  )}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-slate-900">Emergency Contact</h3>
                <p className="text-sm text-slate-500">Add a trusted person we can reach if needed.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label className="mb-2 block">Name</Label>
                <Input
                  placeholder="Name"
                  value={form.emergencyContacts[0]?.name || ""}
                  onChange={(e) => setForm({
                    ...form,
                    emergencyContacts: [{ ...form.emergencyContacts[0], name: e.target.value }]
                  })}
                />
              </div>
              <div>
                <Label className="mb-2 block">Relationship</Label>
                <Select
                  value={form.emergencyContacts[0]?.relation || ""}
                  onValueChange={(value) => setForm({
                    ...form,
                    emergencyContacts: [{ ...form.emergencyContacts[0], relation: value }]
                  })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                  </Select>
                </div>
                <div>
                <Label className="mb-2 block">Mobile Number</Label>
                <Input
                  placeholder="Mobile Number"
                  validationType="phone"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.emergencyContacts[0]?.phone || ""}
                  onChange={(e) => setForm({
                    ...form,
                    emergencyContacts: [{ ...form.emergencyContacts[0], phone: e.target.value }]
                  })}
                />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 pt-2">
              <Button variant="outline" className="min-w-28" onClick={handleCancelEdit} disabled={loading}>
                Cancel
              </Button>
              <Button className="min-w-32 shadow-sm" onClick={handleSave} disabled={loading}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default ProfilePage;
