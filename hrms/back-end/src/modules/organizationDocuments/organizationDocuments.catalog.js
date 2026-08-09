const DOCUMENT_CATEGORIES = [
  "Company Documents",
  "PF / ESIC Documents",
  "Bank & Financial Documents",
  "Payroll Compliance Documents"
];

const DOCUMENT_TYPES = [
  { key: "COMPANY_PAN", category: "Company Documents", name: "Company PAN Card", mandatory: true },
  { key: "GST_CERTIFICATE", category: "Company Documents", name: "GST Certificate", mandatory: false },
  { key: "CERTIFICATE_OF_INCORPORATION", category: "Company Documents", name: "Certificate of Incorporation", mandatory: false },
  { key: "TAN_ALLOTMENT", category: "Company Documents", name: "TAN Allotment Letter", mandatory: true },
  { key: "SHOP_ESTABLISHMENT", category: "Company Documents", name: "Shop & Establishment Certificate", mandatory: false },
  { key: "MSME_CERTIFICATE", category: "Company Documents", name: "MSME Certificate", mandatory: false },

  { key: "PF_REGISTRATION", category: "PF / ESIC Documents", name: "PF Registration Certificate", mandatory: true },
  { key: "PF_ESTABLISHMENT_CODE", category: "PF / ESIC Documents", name: "PF Establishment Code Document", mandatory: false },
  { key: "ESIC_REGISTRATION", category: "PF / ESIC Documents", name: "ESIC Registration Certificate", mandatory: true, conditional: "ESIC_APPLICABLE" },
  { key: "PT_REGISTRATION", category: "PF / ESIC Documents", name: "PT Registration Certificate", mandatory: true },

  { key: "CANCELLED_CHEQUE", category: "Bank & Financial Documents", name: "Cancelled Cheque", mandatory: false },
  { key: "BANK_ACCOUNT_PROOF", category: "Bank & Financial Documents", name: "Bank Account Proof", mandatory: true },
  { key: "AUTHORIZED_SIGNATORY", category: "Bank & Financial Documents", name: "Authorized Signatory Documents", mandatory: false },

  { key: "SALARY_STRUCTURE_POLICY", category: "Payroll Compliance Documents", name: "Salary Structure Policy", mandatory: false },
  { key: "LEAVE_POLICY", category: "Payroll Compliance Documents", name: "Leave Policy", mandatory: false },
  { key: "ATTENDANCE_POLICY", category: "Payroll Compliance Documents", name: "Attendance Policy", mandatory: false },
  { key: "EMPLOYEE_HANDBOOK", category: "Payroll Compliance Documents", name: "Employee Handbook", mandatory: false },
  { key: "OFFER_LETTER_TEMPLATES", category: "Payroll Compliance Documents", name: "Offer Letter Templates", mandatory: false },
  { key: "PAYSLIP_TEMPLATE", category: "Payroll Compliance Documents", name: "Payslip Template", mandatory: false }
];

const DOCUMENT_TYPE_BY_KEY = DOCUMENT_TYPES.reduce((acc, item) => {
  acc[item.key] = item;
  return acc;
}, {});

module.exports = {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_BY_KEY
};
