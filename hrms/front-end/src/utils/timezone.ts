const ORG_TIMEZONE_KEY = "org_timezone";
const DEFAULT_ORG_TIMEZONE = "Asia/Kolkata";
const ORG_TIMEZONE_EVENT = "org-timezone-change";

const isValidTimeZone = (timeZone?: string | null) => {
  try {
    if (!timeZone) return false;
    new Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export const setOrgTimeZone = (timeZone: string) => {
  if (!isValidTimeZone(timeZone)) return;
  const previousTimeZone = localStorage.getItem(ORG_TIMEZONE_KEY);
  localStorage.setItem(ORG_TIMEZONE_KEY, timeZone);
  if (previousTimeZone !== timeZone) {
    window.dispatchEvent(new CustomEvent(ORG_TIMEZONE_EVENT, { detail: timeZone }));
  }
};

export const getOrgTimeZone = () => {
  const storedTimeZone = localStorage.getItem(ORG_TIMEZONE_KEY);
  return isValidTimeZone(storedTimeZone) ? storedTimeZone : DEFAULT_ORG_TIMEZONE;
};

export const subscribeToOrgTimeZone = (listener: (timeZone: string) => void) => {
  const handleTimeZoneChange = (event: Event) => {
    const nextTimeZone = (event as CustomEvent<string>).detail;
    listener(typeof nextTimeZone === "string" && isValidTimeZone(nextTimeZone) ? nextTimeZone : getOrgTimeZone());
  };

  const handleStorageChange = (event: StorageEvent) => {
    if (event.key !== ORG_TIMEZONE_KEY) return;
    listener(getOrgTimeZone());
  };

  window.addEventListener(ORG_TIMEZONE_EVENT, handleTimeZoneChange as EventListener);
  window.addEventListener("storage", handleStorageChange);

  return () => {
    window.removeEventListener(ORG_TIMEZONE_EVENT, handleTimeZoneChange as EventListener);
    window.removeEventListener("storage", handleStorageChange);
  };
};

const toDate = (value: string | number | Date) =>
  value instanceof Date ? value : new Date(value);

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const toDateKeyInOrgTimeZone = (value: string | number | Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: getOrgTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(toDate(value));

  const read = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value || "";

  return `${read("year")}-${read("month")}-${read("day")}`;
};

export const formatDateInOrgTimeZone = (
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {}
) => {
  return toDate(value).toLocaleDateString(undefined, {
    timeZone: getOrgTimeZone(),
    ...options
  });
};

export const toDateKeyInOrgCalendar = (value: string | number | Date) => {
  if (typeof value === "string" && isDateKey(value)) return value;
  return toDateKeyInOrgTimeZone(value);
};

export const formatDateKeyInOrgCalendar = (
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {}
) => {
  const dateKey = toDateKeyInOrgCalendar(value);
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: getOrgTimeZone(),
    ...options
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
};

export const formatTimeInOrgTimeZone = (
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {}
) => {
  return toDate(value).toLocaleTimeString(undefined, {
    timeZone: getOrgTimeZone(),
    ...options
  });
};

export const formatDateTimeInOrgTimeZone = (
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {}
) => {
  return toDate(value).toLocaleString(undefined, {
    timeZone: getOrgTimeZone(),
    ...options
  });
};
