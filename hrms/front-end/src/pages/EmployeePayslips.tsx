import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { getApiWithToken } from "@/services/apiWrapper";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Download, Printer } from "lucide-react";
import { buildMonthOptions, type PayslipData } from "@/components/payroll/payrollShared";

type EmployeePayslipRun = {
  runId: string;
  runCode?: string;
  month: string;
  status?: string;
  employeeExternalId?: string;
};

type PayslipLineItem = {
  code?: string;
  name?: string;
  amount?: number;
};

const normalizeComponentKey = (item: PayslipLineItem) =>
  String(item.code || item.name || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");

const PAYSLIP_LABEL_ALIASES: Record<string, string> = {
  BASIC: "Basic Salary",
  BASIC_PAY: "Basic Salary",
  EARNED_BASIC: "Basic Salary",
  HRA: "House Rent Allowance",
  HOUSE_RENT_ALLOWANCE: "House Rent Allowance",
  OTHER_ALLOWANCE: "Special Allowance",
  FIXED_ALLOWANCE: "Special Allowance",
  SPECIAL_ALLOWANCE: "Special Allowance",
  VARIABLE: "Variable Pay",
  VARIABLE_PAY: "Variable Pay",
  EMPLOYER_EPF: "Employer PF",
  EMPLOYER_PF: "Employer PF",
  EMPLOYER_PROVIDENT_FUND: "Employer PF",
  PF_EMPLOYER_SHARE: "Employer PF",
  EPF: "Employee PF",
  EMPLOYEE_EPF: "Employee PF",
  EMPLOYEE_PROVIDENT_FUND: "Employee PF",
  PF_EMPLOYEE_SHARE: "Employee PF",
  PT: "Professional Tax",
  PROFESSIONAL_TAX: "Professional Tax",
  P_TAX: "Professional Tax"
};

const EARNING_ORDER: Record<string, number> = {
  BASIC: 1,
  BASIC_PAY: 1,
  EARNED_BASIC: 1,
  HRA: 2,
  HOUSE_RENT_ALLOWANCE: 2,
  OTHER_ALLOWANCE: 3,
  FIXED_ALLOWANCE: 3,
  SPECIAL_ALLOWANCE: 3,
  VARIABLE: 4,
  VARIABLE_PAY: 4,
  EMPLOYER_EPF: 5,
  EMPLOYER_PF: 5,
  EMPLOYER_PROVIDENT_FUND: 5,
  PF_EMPLOYER_SHARE: 5,
  FOOD_COUPONS: 90,
  CHILDREN_EDUCATION_ALLOWANCE: 91,
  CHILDREN_EDU_ALLOW: 91
};

const DEDUCTION_ORDER: Record<string, number> = {
  EPF: 1,
  EMPLOYEE_EPF: 1,
  EMPLOYEE_PROVIDENT_FUND: 1,
  PF_EMPLOYEE_SHARE: 1,
  PT: 2,
  PROFESSIONAL_TAX: 2,
  P_TAX: 2,
  TDS: 3,
  PARENTS_MEDICAL_PREMIUM: 90,
  PARENTS_MEDICAL_PREM: 90
};

const formatMonthLabel = (value?: string | null) => {
  if (!value) return "-";
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return String(value);
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric"
  }).format(new Date(year, month - 1, 1));
};

const formatFullMonthLabel = (value?: string | null) => {
  if (!value) return "-";
  const [year, month] = String(value).split("-").map(Number);
  if (!year || !month) return String(value);
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric"
  }).format(new Date(year, month - 1, 1));
};

const formatDateValue = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
};

const formatPlainAmount = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const numberToWordsBelowThousand = (value: number) => {
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen"
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  if (value < 20) return ones[value];
  if (value < 100) {
    return `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${ones[value % 10]}` : ""}`.trim();
  }
  return `${ones[Math.floor(value / 100)]} Hundred${value % 100 ? ` ${numberToWordsBelowThousand(value % 100)}` : ""}`.trim();
};

const amountToWordsIndian = (amount: number) => {
  const value = Math.floor(Number.isFinite(amount) ? amount : 0);
  if (!value) return "Zero Rupees Only";

  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  const remainder = value % 1000;

  const parts = [
    crore ? `${numberToWordsBelowThousand(crore)} Crore` : "",
    lakh ? `${numberToWordsBelowThousand(lakh)} Lakh` : "",
    thousand ? `${numberToWordsBelowThousand(thousand)} Thousand` : "",
    remainder ? numberToWordsBelowThousand(remainder) : ""
  ].filter(Boolean);

  return `${parts.join(" ")} Rupees Only`;
};

const getDisplayName = (item: PayslipLineItem) => {
  const key = normalizeComponentKey(item);
  return PAYSLIP_LABEL_ALIASES[key] || item.name || item.code || "-";
};

const sortPayslipItems = (items: PayslipLineItem[], orderMap: Record<string, number>) =>
  [...items].sort((left, right) => {
    const leftKey = normalizeComponentKey(left);
    const rightKey = normalizeComponentKey(right);
    const leftOrder = orderMap[leftKey] ?? 999;
    const rightOrder = orderMap[rightKey] ?? 999;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return getDisplayName(left).localeCompare(getDisplayName(right));
  });

const EmployeePayslips = () => {
  const defaultMonths = useMemo(() => buildMonthOptions(), []);
  const [monthOptions, setMonthOptions] = useState<string[]>(defaultMonths);
  const [month, setMonth] = useState(defaultMonths[0] || "");
  const [runByMonth, setRunByMonth] = useState<Record<string, EmployeePayslipRun>>({});
  const [loading, setLoading] = useState(false);
  const [payslipData, setPayslipData] = useState<PayslipData | null>(null);
  const [monthsLoaded, setMonthsLoaded] = useState(false);
  const requestSeqRef = useRef(0);

  const loadPayslip = async (selectedMonth: string) => {
    if (!selectedMonth) return;
    const run = runByMonth[selectedMonth];
    if (!run?.runId) {
      setPayslipData(null);
      setLoading(false);
      return;
    }
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    try {
      const res = await getApiWithToken(`/payroll/payslips/my/runs/${run.runId}`);
      if (requestSeq !== requestSeqRef.current) return;
      if (res?.success) {
        setPayslipData((res.data as PayslipData) || null);
      } else {
        setPayslipData(null);
        toast.error(res?.message || "Payslip not available for selected month");
      }
    } finally {
      if (requestSeq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const initMonths = async () => {
      try {
        const res = await getApiWithToken("/payroll/payslips/my/runs");
        const runs =
          res?.success && Array.isArray(res?.data)
            ? (res.data as EmployeePayslipRun[]).filter((row) => row?.month && row?.runId)
            : [];
        const nextRunByMonth = runs.reduce<Record<string, EmployeePayslipRun>>((acc, row) => {
          acc[String(row.month)] = row;
          return acc;
        }, {});
        setRunByMonth(nextRunByMonth);
        const approvedMonths = runs.map((row) => String(row.month).trim()).filter(Boolean);
        const nextMonths = [...new Set([...defaultMonths, ...approvedMonths])].sort((a, b) =>
          b.localeCompare(a)
        );
        setMonthOptions(nextMonths);
        setMonth((current) =>
          current && nextMonths.includes(current) ? current : nextMonths[0] || ""
        );
      } finally {
        setMonthsLoaded(true);
      }
    };
    initMonths();
  }, [defaultMonths]);

  useEffect(() => {
    if (!monthsLoaded || !month) return;
    loadPayslip(month);
  }, [month, monthsLoaded, runByMonth]);

  const payslip = payslipData?.payslipJson;
  const fileMonth = payslip?.payMonth || month;
  const activeRun = {
    runCode: payslipData?.pdfPayload?.header?.payrollRunCode || payslip?.runId || null,
    status: payslip?.payrollStatus || null
  };

  const earningsRows = useMemo(
    () =>
      sortPayslipItems(
        [
          ...((payslip?.earnings || []) as PayslipLineItem[]),
          ...((payslip?.employerContributions || []) as PayslipLineItem[])
        ],
        EARNING_ORDER
      ),
    [payslip?.earnings, payslip?.employerContributions]
  );

  const deductionRows = useMemo(
    () => sortPayslipItems((payslip?.deductions || []) as PayslipLineItem[], DEDUCTION_ORDER),
    [payslip?.deductions]
  );

  const tableRows = useMemo(() => {
    const maxRows = Math.max(earningsRows.length, deductionRows.length);
    return Array.from({ length: maxRows }, (_, index) => ({
      earning: earningsRows[index] || null,
      deduction: deductionRows[index] || null
    }));
  }, [deductionRows, earningsRows]);

  const earningsTotal = useMemo(
    () => earningsRows.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [earningsRows]
  );
  const deductionsTotal = useMemo(
    () => deductionRows.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [deductionRows]
  );

  const headerFields = useMemo(
    () => [
      { label: "Emp Code", value: payslip?.employee?.employeeCode || "-" },
      { label: "Employee Name", value: payslip?.employee?.name || "-" },
      { label: "Department", value: payslip?.employee?.department || "-" },
      { label: "Designation", value: payslip?.employee?.designation || "-" },
      { label: "Bank Name", value: payslip?.bank?.bankName || "-" },
      { label: "Bank Account", value: payslip?.bank?.accountNumberMasked || "-" },
      { label: "Branch", value: payslip?.bank?.branchName || "-" },
      { label: "IFSC Code", value: payslip?.bank?.ifscCode || "-" },
      { label: "Payment Mode", value: payslip?.bank?.paymentMode || "-" },
      { label: "PAN No", value: payslip?.statutory?.pan || "-" },
      { label: "UAN No", value: payslip?.statutory?.uan || "-" },
      { label: "ESIC No", value: payslip?.statutory?.esicNumber || "-" }
    ],
    [payslip]
  );

  const attendanceMetrics = useMemo(() => {
    const summary = payslip?.attendanceSummary;
    const halfDays = Number(summary?.halfDays || 0);
    const unpaidLeaveDays = Number(summary?.unpaidLeaveDays || 0);
    const paidLeaveDays = Number(summary?.paidLeaveDays || 0);
    const lopDays = Number(summary?.lopDays || 0);
    const attendanceAbsentDays = Number(summary?.absentDays || 0);
    const nonLeaveLopDays = Math.max(0, lopDays - unpaidLeaveDays);

    return [
      { label: "Payable Days", value: Number(summary?.payableDays || 0).toFixed(2), tone: "green" },
      { label: "Present", value: (Number(summary?.presentDays || 0) + halfDays).toFixed(2), tone: "green" },
      { label: "Leave", value: (paidLeaveDays + unpaidLeaveDays).toFixed(2), tone: "slate" },
      { label: "Absent", value: Math.max(attendanceAbsentDays, nonLeaveLopDays).toFixed(2), tone: "amber" },
      { label: "Week Off", value: Number(summary?.weekOffDays || 0).toFixed(2), tone: "slate" },
      { label: "Holiday", value: Number(summary?.holidayDays || 0).toFixed(2), tone: "slate" },
      { label: "LOP", value: lopDays.toFixed(2), tone: "amber" },
      { label: "Total Days", value: Number(summary?.calendarDays || 0).toFixed(2), tone: "slate" }
    ];
  }, [payslip?.attendanceSummary]);

  const payrollMetrics = useMemo(
    () => [
      { label: "Gross Earnings", value: formatPlainAmount(Number(payslip?.totals?.grossEarnings || 0)) },
      { label: "Employer Contributions", value: formatPlainAmount(Number(payslip?.totals?.employerContributions || 0)) },
      { label: "Total Deductions", value: formatPlainAmount(Number(payslip?.totals?.totalDeductions || 0)) },
      { label: "Taxable Income", value: formatPlainAmount(Number(payslip?.totals?.taxableIncome || 0)) },
      { label: "TDS", value: formatPlainAmount(Number(payslip?.totals?.tds || 0)) },
      { label: "Net Pay", value: formatPlainAmount(Number(payslip?.totals?.netPay || 0)) }
    ],
    [payslip?.totals]
  );
  const earningsBreakdownRows = useMemo(
    () =>
      earningsRows.map((item) => ({
        code: item.code || item.name || "-",
        label: getDisplayName(item),
        amount: Number(item.amount || 0)
      })),
    [earningsRows]
  );

  const buildPayslipHtml = () => {
    if (!payslip) return "";
    const rowsHtml = tableRows
      .map(({ earning, deduction }) => {
        const earningName = earning ? getDisplayName(earning) : "&nbsp;";
        const earningAmount = earning ? formatPlainAmount(Number(earning.amount || 0)) : "&nbsp;";
        const deductionName = deduction ? getDisplayName(deduction) : "&nbsp;";
        const deductionAmount = deduction ? formatPlainAmount(Number(deduction.amount || 0)) : "&nbsp;";
        return `
          <tr>
            <td>${escapeHtml(earningName)}</td>
            <td class="amount">${earningAmount}</td>
            <td>${escapeHtml(deductionName)}</td>
            <td class="amount">${deductionAmount}</td>
          </tr>
        `;
      })
      .join("");

    const fieldRows = Array.from({ length: Math.ceil(headerFields.length / 4) }, (_, index) =>
      headerFields.slice(index * 4, index * 4 + 4)
    )
      .map(
        (group) => `
          <tr>
            ${group
              .map(
                (item) => `
                  <td class="label">${escapeHtml(item.label)}</td>
                  <td class="value">${escapeHtml(item.value)}</td>
                `
              )
              .join("")}
          </tr>
        `
      )
      .join("");

    return `
      <html>
        <head>
          <title>Payslip ${escapeHtml(fileMonth)}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; background: #ffffff; color: #1f2937; }
            .page { padding: 28px 36px; }
            .header { display: flex; align-items: center; gap: 18px; border-bottom: 1px solid #d1d5db; padding-bottom: 16px; }
            .logo { width: 84px; height: 84px; object-fit: contain; }
            .header-copy { flex: 1; text-align: center; }
            .company { margin: 0; color: #2f6f3e; font-size: 28px; font-weight: 700; }
            .subtitle { margin: 10px 0 0; font-size: 14px; color: #6b7280; }
            .meta-table, .line-table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            .meta-table td, .line-table td, .line-table th { border: 1px solid #d1d5db; padding: 8px 10px; font-size: 13px; }
            .meta-table .label { width: 12%; background: #f8fafc; font-weight: 700; }
            .meta-table .value { width: 13%; }
            .strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; font-size: 15px; font-weight: 700; }
            .strip-box { border: 1px solid #d1d5db; padding: 10px 12px; background: #fafafa; display: flex; justify-content: space-between; }
            .green { color: #2f6f3e; }
            .red { color: #c2410c; }
            .amber { color: #c2410c; }
            .slate { color: #334155; }
            .payroll-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 0 0 16px; }
            .metric-card { border: 1px solid #d1d5db; background: #fafafa; padding: 12px; }
            .metric-card .metric-label { font-size: 12px; color: #64748b; }
            .metric-card .metric-value { margin-top: 6px; font-size: 18px; font-weight: 700; color: #111827; }
            .line-table th { background: #f3f4f6; font-size: 14px; text-align: left; }
            .line-table .amount { text-align: right; }
            .line-table .total-row td { font-weight: 700; background: #f8fafc; }
            .line-table .net-row td { font-weight: 700; background: #f9fafb; }
            .footer-note { margin-top: 14px; font-size: 12px; color: #6b7280; }
            .net-words { margin-top: 10px; padding: 10px 12px; border: 1px solid #d1d5db; font-weight: 700; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="header">
              ${
                payslip.company?.logoUrl
                  ? `<img class="logo" src="${escapeHtml(payslip.company.logoUrl)}" alt="Company Logo" />`
                  : ""
              }
              <div class="header-copy">
                <h1 class="company">${escapeHtml(payslip.company?.name || "Company")}</h1>
                <p class="subtitle">Payslip for the month ${escapeHtml(formatMonthLabel(payslip.payMonth || month))}</p>
              </div>
            </div>

            <table class="meta-table">
              <tbody>${fieldRows}</tbody>
            </table>

            <div class="strip">
              ${attendanceMetrics
                .map(
                  (item) => `
                    <div class="strip-box">
                      <span>${escapeHtml(item.label)}</span>
                      <span class="${item.tone}">${escapeHtml(item.value)}</span>
                    </div>
                  `
                )
                .join("")}
            </div>

            <div class="payroll-grid">
              ${payrollMetrics
                .map(
                  (item) => `
                    <div class="metric-card">
                      <div class="metric-label">${escapeHtml(item.label)}</div>
                      <div class="metric-value">${escapeHtml(item.value)}</div>
                    </div>
                  `
                )
                .join("")}
            </div>

            <table class="line-table">
              <thead>
                <tr>
                  <th>Earnings</th>
                  <th class="amount">Amount</th>
                  <th>Deductions & Recoveries</th>
                  <th class="amount">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
                <tr class="total-row">
                  <td>Amount Total</td>
                  <td class="amount">${formatPlainAmount(earningsTotal)}</td>
                  <td>Amount Total</td>
                  <td class="amount">${formatPlainAmount(deductionsTotal)}</td>
                </tr>
                <tr class="net-row">
                  <td colspan="2"></td>
                  <td>Net Pay</td>
                  <td class="amount">${formatPlainAmount(Number(payslip.totals?.netPay || 0))}</td>
                </tr>
              </tbody>
            </table>

            <div class="net-words">Net Pay : ${escapeHtml(amountToWordsIndian(Number(payslip.totals?.netPay || 0)))}</div>
            <p class="footer-note">This is a computer generated payslip and does not require signature.</p>
          </div>
        </body>
      </html>
    `;
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
    } catch {
      try {
        const resolved = new URL(src, window.location.href);
        if (resolved.origin === window.location.origin) return resolved.toString();
      } catch {
        if (src.startsWith("/")) return src;
      }
      return "";
    }
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
    const marginPt = 16;
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

  const pngToJpegPage = async (pngDataUrl: string) => {
    const img = await loadImage(pngDataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const response = await fetch(canvas.toDataURL("image/jpeg", 0.92));
    return {
      width: canvas.width,
      height: canvas.height,
      jpegBytes: new Uint8Array(await response.arrayBuffer())
    };
  };

  const renderPayslipCanvas = async () => {
    if (!payslip) throw new Error("No payslip data available");
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 1900;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#d1d5db";
    ctx.fillStyle = "#1f2937";

    const logoSrc = await getCanvasSafeImageSrc(String(payslip.company?.logoUrl || ""));
    if (logoSrc) {
      try {
        const logo = await loadImage(logoSrc);
        const scale = Math.min(120 / logo.naturalWidth, 90 / logo.naturalHeight, 1);
        ctx.drawImage(logo, 70, 48, logo.naturalWidth * scale, logo.naturalHeight * scale);
      } catch {
        // Keep PDF generation usable without logo.
      }
    }

    ctx.fillStyle = "#2f6f3e";
    ctx.font = "bold 34px Arial";
    ctx.textAlign = "center";
    ctx.fillText(String(payslip.company?.name || "Company"), 700, 86);
    ctx.fillStyle = "#6b7280";
    ctx.font = "20px Arial";
    ctx.fillText(`Payslip for the month ${formatMonthLabel(payslip.payMonth || month)}`, 700, 122);
    ctx.textAlign = "left";

    const drawBoxRow = (y: number, pairs: Array<{ label: string; value: string }>) => {
      let x = 60;
      pairs.forEach((pair) => {
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(x, y, 320, 42);
        ctx.strokeRect(x, y, 320, 42);
        ctx.fillStyle = "#334155";
        ctx.font = "bold 13px Arial";
        ctx.fillText(pair.label, x + 10, y + 26);
        ctx.fillStyle = "#111827";
        ctx.font = "13px Arial";
        ctx.fillText(pair.value, x + 124, y + 26);
        x += 320;
      });
    };

    const fieldPairs = headerFields.map((field) => ({ label: field.label, value: String(field.value || "-") }));
    let currentY = 165;
    for (let index = 0; index < fieldPairs.length; index += 4) {
      drawBoxRow(currentY, fieldPairs.slice(index, index + 4));
      currentY += 42;
    }

    const attendanceCardWidth = 300;
    attendanceMetrics.forEach((item, index) => {
      const row = Math.floor(index / 4);
      const col = index % 4;
      const x = 60 + col * (attendanceCardWidth + 14);
      const y = currentY + 18 + row * 70;
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(x, y, attendanceCardWidth, 56);
      ctx.strokeRect(x, y, attendanceCardWidth, 56);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 16px Arial";
      ctx.fillText(item.label, x + 14, y + 34);
      ctx.fillStyle = item.tone === "green" ? "#2f6f3e" : item.tone === "amber" ? "#c2410c" : "#334155";
      const width = ctx.measureText(item.value).width;
      ctx.fillText(item.value, x + attendanceCardWidth - width - 14, y + 34);
    });

    currentY += 34 + Math.ceil(attendanceMetrics.length / 4) * 70;
    const payrollCardWidth = 398;
    payrollMetrics.forEach((item, index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;
      const x = 60 + col * (payrollCardWidth + 14);
      const y = currentY + row * 74;
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(x, y, payrollCardWidth, 60);
      ctx.strokeRect(x, y, payrollCardWidth, 60);
      ctx.fillStyle = "#64748b";
      ctx.font = "13px Arial";
      ctx.fillText(item.label, x + 14, y + 22);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 20px Arial";
      ctx.fillText(item.value, x + 14, y + 46);
    });

    currentY += 164;
    const tableX = 60;
    const colWidths = [440, 180, 440, 180];
    const rowHeight = 42;
    const headerTitles = ["Earnings", "Amount", "Deductions & Recoveries", "Amount"];

    let xCursor = tableX;
    headerTitles.forEach((title, index) => {
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(xCursor, currentY, colWidths[index], rowHeight);
      ctx.strokeRect(xCursor, currentY, colWidths[index], rowHeight);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 15px Arial";
      ctx.fillText(title, xCursor + 10, currentY + 26);
      xCursor += colWidths[index];
    });

    let rowY = currentY + rowHeight;
    tableRows.forEach(({ earning, deduction }) => {
      const values = [
        earning ? getDisplayName(earning) : "",
        earning ? formatPlainAmount(Number(earning.amount || 0)) : "",
        deduction ? getDisplayName(deduction) : "",
        deduction ? formatPlainAmount(Number(deduction.amount || 0)) : ""
      ];
      let rowX = tableX;
      values.forEach((value, index) => {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(rowX, rowY, colWidths[index], rowHeight);
        ctx.strokeRect(rowX, rowY, colWidths[index], rowHeight);
        ctx.fillStyle = "#374151";
        ctx.font = "14px Arial";
        const isAmount = index === 1 || index === 3;
        if (isAmount) {
          const width = ctx.measureText(value).width;
          ctx.fillText(value, rowX + colWidths[index] - width - 10, rowY + 26);
        } else {
          ctx.fillText(value || "-", rowX + 10, rowY + 26);
        }
        rowX += colWidths[index];
      });
      rowY += rowHeight;
    });

    const totalValues = ["Amount Total", formatPlainAmount(earningsTotal), "Amount Total", formatPlainAmount(deductionsTotal)];
    let totalX = tableX;
    totalValues.forEach((value, index) => {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(totalX, rowY, colWidths[index], rowHeight);
      ctx.strokeRect(totalX, rowY, colWidths[index], rowHeight);
      ctx.fillStyle = "#111827";
      ctx.font = "bold 14px Arial";
      const isAmount = index === 1 || index === 3;
      if (isAmount) {
        const width = ctx.measureText(value).width;
        ctx.fillText(value, totalX + colWidths[index] - width - 10, rowY + 26);
      } else {
        ctx.fillText(value, totalX + 10, rowY + 26);
      }
      totalX += colWidths[index];
    });

    rowY += rowHeight;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tableX, rowY, colWidths[0] + colWidths[1], rowHeight);
    ctx.strokeRect(tableX, rowY, colWidths[0] + colWidths[1], rowHeight);
    ctx.fillStyle = "#f9fafb";
    ctx.fillRect(tableX + colWidths[0] + colWidths[1], rowY, colWidths[2], rowHeight);
    ctx.fillRect(tableX + colWidths[0] + colWidths[1] + colWidths[2], rowY, colWidths[3], rowHeight);
    ctx.strokeRect(tableX + colWidths[0] + colWidths[1], rowY, colWidths[2], rowHeight);
    ctx.strokeRect(tableX + colWidths[0] + colWidths[1] + colWidths[2], rowY, colWidths[3], rowHeight);
    ctx.fillStyle = "#111827";
    ctx.font = "bold 14px Arial";
    ctx.fillText("Net Pay", tableX + colWidths[0] + colWidths[1] + 10, rowY + 26);
    const netValue = formatPlainAmount(Number(payslip.totals?.netPay || 0));
    const netWidth = ctx.measureText(netValue).width;
    ctx.fillText(netValue, tableX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] - netWidth - 10, rowY + 26);

    rowY += rowHeight + 18;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tableX, rowY, 1240, 54);
    ctx.strokeRect(tableX, rowY, 1240, 54);
    ctx.fillStyle = "#111827";
    ctx.font = "bold 16px Arial";
    ctx.fillText(`Net Pay : ${amountToWordsIndian(Number(payslip.totals?.netPay || 0))}`, tableX + 12, rowY + 34);

    ctx.fillStyle = "#6b7280";
    ctx.font = "15px Arial";
    ctx.fillText("This is a computer generated payslip and does not require signature.", 60, 1825);

    return canvas.toDataURL("image/jpeg", 0.95);
  };

  const downloadPdf = async () => {
    try {
      const pngDataUrl = await renderPayslipCanvas();
      const jpegPage = await pngToJpegPage(pngDataUrl);
      const pdfBlob = buildPdfBlobFromJpegPages([jpegPage]);
      const blobUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `payslip-${fileMonth || "payroll"}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      toast.success("Payslip PDF downloaded");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Unable to generate PDF: ${message}`);
    }
  };

  const downloadJson = () => {
    if (!payslipData) return;
    const blob = new Blob([JSON.stringify(payslipData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `payslip-${fileMonth}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const printPayslip = () => {
    if (!payslip) return;
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1024,height=900");
    if (!printWindow) {
      toast.error("Unable to open print window");
      return;
    }
    printWindow.document.write(buildPayslipHtml());
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My Payslips</h1>
          <p className="text-sm text-muted-foreground">Structured monthly salary slip from finalized payroll runs.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[180px]">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger>
                <SelectValue placeholder="Select month" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((option) => (
                  <SelectItem key={option} value={option}>{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={downloadPdf} disabled={!payslip}>
            <Download className="mr-2 h-4 w-4" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={printPayslip} disabled={!payslip}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          <Button size="sm" onClick={downloadJson} disabled={!payslipData}>
            <Download className="mr-2 h-4 w-4" /> JSON
          </Button>
        </div>
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-[640px] w-full" />
          </CardContent>
        </Card>
      ) : !payslip ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="font-medium text-slate-700">
              Payroll not processed for {formatFullMonthLabel(month)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your payslip will be available after payroll is approved.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-slate-200">
          <CardContent className="bg-white p-0">
            <div className="border-b px-8 py-6">
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-24 items-center justify-center overflow-hidden">
                  {payslip.company?.logoUrl ? (
                    <img src={payslip.company.logoUrl} alt="Company logo" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-xs text-slate-400">Logo</span>
                  )}
                </div>
                <div className="flex-1 text-center">
                  <h2 className="text-4xl font-bold uppercase tracking-tight text-green-800">
                    {payslip.company?.name || "Company"}
                  </h2>
                  <p className="mt-3 text-base text-slate-500">
                    Payslip for the month {formatMonthLabel(payslip.payMonth || month)}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {activeRun?.runCode ? `Payroll Run ${activeRun.runCode}` : "Finalized payroll payslip"}
                    {activeRun?.status ? ` · ${activeRun.status}` : ""}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-8 py-5">
              <table className="w-full border-collapse text-sm">
                      <tbody>
                        {Array.from({ length: Math.ceil(headerFields.length / 4) }, (_, index) =>
                          headerFields.slice(index * 4, index * 4 + 4)
                        ).map((group, rowIndex) => (
                          <tr key={rowIndex} className="border-b">
                            {group.map((item) => (
                              <Fragment key={item.label}>
                                <td className="w-[12%] bg-slate-50 px-3 py-2 font-semibold text-slate-700">
                                  {item.label}
                                </td>
                                <td className="w-[13%] px-3 py-2 text-slate-900">
                                  {item.value}
                                </td>
                              </Fragment>
                            ))}
                          </tr>
                        ))}
                      </tbody>
              </table>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {attendanceMetrics.map((item) => (
                  <div key={item.label} className="flex items-center justify-between border bg-slate-50 px-4 py-3">
                    <span className="font-semibold text-slate-700">{item.label}</span>
                    <span
                      className={`font-bold ${
                        item.tone === "green"
                          ? "text-green-700"
                          : item.tone === "amber"
                            ? "text-amber-700"
                            : "text-slate-700"
                      }`}
                    >
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {payrollMetrics.map((item) => (
                  <div key={item.label} className="border bg-slate-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-500">{item.label}</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 border bg-slate-50 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Dynamic Earnings Breakdown</p>
                    <p className="text-xs text-slate-500">
                      This section comes from the saved payroll run, so custom components like Conveyance
                      appear automatically.
                    </p>
                  </div>
                  <p className="text-xs text-slate-500">{earningsBreakdownRows.length} active</p>
                </div>
                {earningsBreakdownRows.length > 0 ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {earningsBreakdownRows.map((item) => (
                      <div key={item.code} className="flex items-center justify-between border bg-white px-3 py-2">
                        <span className="min-w-0">
                          <span className="block font-medium text-slate-800">{item.label}</span>
                          <span className="block text-xs text-slate-500">{item.code}</span>
                        </span>
                        <span className="font-semibold text-slate-900">{formatPlainAmount(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No earnings components found for this payslip.</p>
                )}
              </div>

              <div className="mt-5 overflow-hidden border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="w-[38%] border-b border-r px-3 py-2 text-left text-lg font-semibold text-slate-700">Earnings</th>
                      <th className="w-[12%] border-b border-r px-3 py-2 text-right text-lg font-semibold text-slate-700">Amount</th>
                      <th className="w-[38%] border-b border-r px-3 py-2 text-left text-lg font-semibold text-slate-700">Deductions & Recoveries</th>
                      <th className="w-[12%] border-b px-3 py-2 text-right text-lg font-semibold text-slate-700">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map(({ earning, deduction }, index) => (
                      <tr key={index} className="border-b last:border-b-0">
                        <td className="border-r px-3 py-2 text-slate-700">{earning ? getDisplayName(earning) : ""}</td>
                        <td className="border-r px-3 py-2 text-right text-slate-700">
                          {earning ? formatPlainAmount(Number(earning.amount || 0)) : ""}
                        </td>
                        <td className="border-r px-3 py-2 text-slate-700">{deduction ? getDisplayName(deduction) : ""}</td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {deduction ? formatPlainAmount(Number(deduction.amount || 0)) : ""}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-semibold">
                      <td className="border-r px-3 py-3 text-right text-slate-700">Amount Total :</td>
                      <td className="border-r px-3 py-3 text-right text-slate-900">{formatPlainAmount(earningsTotal)}</td>
                      <td className="border-r px-3 py-3 text-right text-slate-700">Amount Total :</td>
                      <td className="px-3 py-3 text-right text-slate-900">{formatPlainAmount(deductionsTotal)}</td>
                    </tr>
                    <tr className="font-semibold">
                      <td colSpan={2} className="border-r px-3 py-3" />
                      <td className="border-r px-3 py-3 text-right text-slate-700">Net Pay :</td>
                      <td className="px-3 py-3 text-right text-slate-900">
                        {formatPlainAmount(Number(payslip.totals?.netPay || 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-4 border px-3 py-3 text-sm">
                <span className="font-semibold">Net Pay :</span> {amountToWordsIndian(Number(payslip.totals?.netPay || 0))}
              </div>

              <p className="mt-5 text-sm text-slate-500">
                This is a computer generated payslip and does not require signature.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default EmployeePayslips;
