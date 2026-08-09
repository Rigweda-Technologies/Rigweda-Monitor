const { toDateKeyInTimeZone } = require("../../utils/timezone");

const isDateKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const normalizeAttendanceRequestDateKey = (value, timeZone) => {
  if (isDateKey(value)) return value;
  return toDateKeyInTimeZone(value, timeZone);
};

module.exports = {
  isDateKey,
  normalizeAttendanceRequestDateKey
};
