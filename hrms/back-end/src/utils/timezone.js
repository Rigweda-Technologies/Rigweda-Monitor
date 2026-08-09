const pad2 = (value) => String(value).padStart(2, "0");

const parseDateKey = (dateKey) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
};

const isValidTimeZone = (timeZone) => {
  try {
    if (!timeZone || typeof timeZone !== "string") return false;
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch (_) {
    return false;
  }
};

const getZonedParts = (dateValue, timeZone) => {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const parts = formatter.formatToParts(date);
  const valueByType = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      valueByType[part.type] = part.value;
    }
  }

  return {
    year: Number(valueByType.year),
    month: Number(valueByType.month),
    day: Number(valueByType.day),
    hour: Number(valueByType.hour),
    minute: Number(valueByType.minute),
    second: Number(valueByType.second)
  };
};

const toDateKeyInTimeZone = (dateValue, timeZone) => {
  if (parseDateKey(dateValue)) {
    return String(dateValue);
  }
  const parts = getZonedParts(dateValue, timeZone);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
};

const addDaysToDateKey = (dateKey, dayDelta) => {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  const baseUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const shifted = new Date(baseUtc + Number(dayDelta || 0) * 24 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
};

const zonedDateTimeToUtc = (dateKey, hhmm, timeZone) => {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  const [hhRaw, mmRaw] = String(hhmm || "00:00").split(":");
  const hour = Number(hhRaw || 0);
  const minute = Number(mmRaw || 0);

  let timestamp = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour, minute, 0, 0);

  // Iterate to align UTC instant with requested local wall-clock in target timezone.
  for (let i = 0; i < 5; i += 1) {
    const zoned = getZonedParts(new Date(timestamp), timeZone);
    const desiredPseudoUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour, minute, 0, 0);
    const actualPseudoUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      0,
      0
    );
    const delta = desiredPseudoUtc - actualPseudoUtc;
    if (delta === 0) break;
    timestamp += delta;
  }

  return new Date(timestamp);
};

const startOfDayInTimeZone = (dateValueOrKey, timeZone) => {
  const dateKey = parseDateKey(dateValueOrKey)
    ? String(dateValueOrKey)
    : toDateKeyInTimeZone(dateValueOrKey, timeZone);
  return zonedDateTimeToUtc(dateKey, "00:00", timeZone);
};

const endOfDayInTimeZone = (dateValueOrKey, timeZone) => {
  const dateKey = parseDateKey(dateValueOrKey)
    ? String(dateValueOrKey)
    : toDateKeyInTimeZone(dateValueOrKey, timeZone);
  const nextDayKey = addDaysToDateKey(dateKey, 1);
  const nextDayStart = zonedDateTimeToUtc(nextDayKey, "00:00", timeZone);
  return new Date(nextDayStart.getTime() - 1);
};

const parseMonthRangeInTimeZone = (monthValue, timeZone) => {
  const now = new Date();
  let year = Number(toDateKeyInTimeZone(now, timeZone).slice(0, 4));
  let month = Number(toDateKeyInTimeZone(now, timeZone).slice(5, 7));

  if (typeof monthValue === "string" && /^\d{4}-\d{2}$/.test(monthValue)) {
    const [y, m] = monthValue.split("-").map(Number);
    year = y;
    month = m;
  }

  const startKey = `${year}-${pad2(month)}-01`;
  const nextMonthUtc = month === 12
    ? Date.UTC(year + 1, 0, 1)
    : Date.UTC(year, month, 1);
  const monthEndUtc = new Date(nextMonthUtc - 1);
  const endDay = monthEndUtc.getUTCDate();
  const endKey = `${year}-${pad2(month)}-${pad2(endDay)}`;

  return {
    year,
    month,
    start: startOfDayInTimeZone(startKey, timeZone),
    end: endOfDayInTimeZone(endKey, timeZone),
    startKey,
    endKey,
    daysInMonth: endDay
  };
};

const getDayInTimeZone = (dateValue, timeZone) => {
  return Number(toDateKeyInTimeZone(dateValue, timeZone).slice(8, 10));
};

const getWeekdayForDateKey = (dateKey, timeZone) => {
  const noonUtc = zonedDateTimeToUtc(dateKey, "12:00", timeZone);
  const weekdayText = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short"
  }).format(noonUtc);
  const map = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return map[weekdayText] ?? 0;
};

module.exports = {
  isValidTimeZone,
  parseDateKey,
  toDateKeyInTimeZone,
  addDaysToDateKey,
  zonedDateTimeToUtc,
  startOfDayInTimeZone,
  endOfDayInTimeZone,
  parseMonthRangeInTimeZone,
  getDayInTimeZone,
  getWeekdayForDateKey
};
