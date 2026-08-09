export const sanitizeNameInput = (value: string): string => {
  const lettersAndSpacesOnly = String(value || "").replace(/[^A-Za-z\s]/g, "");
  return lettersAndSpacesOnly.replace(/\s{2,}/g, " ");
};

export const sanitizeDesignationNameInput = (value: string): string => {
  const allowedDesignationCharsOnly = String(value || "").replace(/[^A-Za-z&\-\s]/g, "");
  return allowedDesignationCharsOnly.replace(/\s{2,}/g, " ");
};

export const sanitizeEmailInput = (value: string): string =>
  String(value || "").toLowerCase().replace(/\s+/g, "");

export const sanitizePhoneInput = (value: string, maxLength = 15): string =>
  String(value || "").replace(/[^\d]/g, "").slice(0, maxLength);

export const sanitizeCodeInput = (value: string): string =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");

export const sanitizeSlugInput = (value: string): string =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
