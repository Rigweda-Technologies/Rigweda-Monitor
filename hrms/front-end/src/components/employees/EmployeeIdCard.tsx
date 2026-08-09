import { useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

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

const maskValue = (value?: string, visibleTail = 4) => {
  const text = String(value || "").trim();
  if (!text) return "-";
  if (text.length <= visibleTail) return "*".repeat(text.length);
  return `${"*".repeat(Math.max(4, text.length - visibleTail))}${text.slice(-visibleTail)}`;
};

type EmployeeIdCardProps = {
  employee: {
    firstName?: string;
    lastName?: string;
    employeeCode?: string;
    phone?: string;
    bloodGroup?: string;
    profileImage?: string;
    designationId?: { name?: string } | null;
    emergencyContacts?: Array<{ phone?: string }>;
  };
};

export const EmployeeIdCard = ({ employee }: EmployeeIdCardProps) => {
  const [idCardSide, setIdCardSide] = useState<"front" | "back">("front");
  const [exportingBothPdf, setExportingBothPdf] = useState(false);
  const [showSensitive, setShowSensitive] = useState(false);
  const idCardRef = useRef<HTMLDivElement | null>(null);

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
    const yCenter = yTop + elementRect.height / 2;
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
      const profileImageSrc = await getCanvasSafeImageSrc(employee?.profileImage || "");
      if (profileImageSrc) {
        const profileImage = await loadImage(profileImageSrc);
        ctx.drawImage(profileImage, width * 0.222, height * 0.243, width * 0.512, height * 0.372);
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
    return {
      width: canvas.width,
      height: canvas.height,
      jpegBytes: await dataUrlToBytes(canvas.toDataURL("image/jpeg", 0.92))
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
      pushText("\nendobj\n");
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
      pushText(`${(xrefOffsets[objectId] || 0).toString().padStart(10, "0")} 00000 n \n`);
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
      toast.error(`Unable to generate both sides PDF: ${message}`);
    } finally {
      setExportingBothPdf(false);
    }
  };

  return (
    <div className="stat-card space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-base font-semibold">Employee ID Card</h3>
          <p className="text-sm text-muted-foreground">Admin preview of employee digital ID card</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-lg border bg-muted/40 p-1">
            <Button size="sm" variant={idCardSide === "front" ? "default" : "ghost"} onClick={() => setIdCardSide("front")}>
              Front
            </Button>
            <Button size="sm" variant={idCardSide === "back" ? "default" : "ghost"} onClick={() => setIdCardSide("back")}>
              Back
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowSensitive((prev) => !prev)}>
            {showSensitive ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
            {showSensitive ? "Hide Sensitive" : "Show Sensitive"}
          </Button>
          <Button size="sm" variant="outline" onClick={downloadIdCardPng}>Download PNG</Button>
          <Button size="sm" onClick={downloadIdCardPdf}>Download PDF</Button>
          <Button size="sm" variant="secondary" onClick={downloadBothSidesPdf} disabled={exportingBothPdf}>
            {exportingBothPdf ? "Preparing..." : "Both Sides PDF"}
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-[390px] overflow-x-auto">
        <div ref={idCardRef} className="relative h-[604px] w-[360px] overflow-hidden rounded-[18px] border-[4px] border-[#0f4a79] bg-[#edf2f8]">
          <img
            src={idCardSide === "front" ? ID_CARD_FRONT_SKELETON : ID_CARD_BACK_SKELETON}
            alt={idCardSide === "front" ? "ID card front skeleton" : "ID card back skeleton"}
            className="absolute inset-0 h-full w-full object-cover"
          />

          <div className="relative z-10 h-full">
            {idCardSide === "front" ? (
              <>
                {employee?.profileImage && (
                  <div className="absolute left-[22.2%] top-[24.3%] h-[37.2%] w-[51.2%] overflow-hidden">
                    <img src={employee.profileImage} alt="ID profile" className="h-full w-full object-cover" />
                  </div>
                )}

                <div className="absolute left-[8%] right-[8%] top-[64.9%] text-center">
                  <p data-idcard-name className="text-[17px] font-extrabold uppercase leading-tight tracking-[0.6px] text-[#0a4874] sm:text-[19px]">
                    {formatIdCardName(employee?.firstName, employee?.lastName)}
                  </p>
                  <p data-idcard-designation className="mt-1 text-[13px] font-bold uppercase leading-tight text-[#0a4874] sm:text-[14px]">
                    {employee?.designationId?.name || "Designation"}
                  </p>
                </div>

                <div className="absolute left-[53.2%] top-[75.2%] text-[12px] font-medium leading-[1.78] text-[#0a4874] sm:text-[13px]">
                  <p data-idcard-info>{employee?.employeeCode || "-"}</p>
                  <p data-idcard-info>{showSensitive ? (employee?.phone || "-") : maskValue(employee?.phone)}</p>
                  <p data-idcard-info>{showSensitive ? (employee?.emergencyContacts?.[0]?.phone || "-") : maskValue(employee?.emergencyContacts?.[0]?.phone)}</p>
                  <p data-idcard-info>{showSensitive ? (employee?.bloodGroup || "-") : maskValue(employee?.bloodGroup, 1)}</p>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
