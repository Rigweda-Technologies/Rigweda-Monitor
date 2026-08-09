const {
  toDateKeyInTimeZone,
  addDaysToDateKey,
  getWeekdayForDateKey
} = require("../../utils/timezone");

const toDateKeyInOrgTz = (value, timeZone) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))
    ? String(value)
    : toDateKeyInTimeZone(value, timeZone);

const buildLeaveDayMeta = ({
  fromDate,
  toDate,
  weekOffDays = [],
  holidaySet = new Set(),
  timeZone = "Asia/Kolkata"
}) => {
  const dayMeta = [];
  let cursorKey = toDateKeyInOrgTz(fromDate, timeZone);
  const endKey = toDateKeyInOrgTz(toDate, timeZone);

  while (cursorKey <= endKey) {
    const isWeekOff = weekOffDays.includes(getWeekdayForDateKey(cursorKey, timeZone));
    const isHoliday = holidaySet.has(cursorKey);
    dayMeta.push({
      key: cursorKey,
      isWeekOff,
      isHoliday,
      excluded: isWeekOff || isHoliday
    });
    cursorKey = addDaysToDateKey(cursorKey, 1);
  }

  return dayMeta;
};

const getSandwichDeductedDateKeysFromDayMeta = (dayMeta = []) => {
  const deducted = [];
  let index = 0;

  while (index < dayMeta.length) {
    const day = dayMeta[index];
    if (!day?.excluded) {
      index += 1;
      continue;
    }

    const blockStart = index;
    while (index < dayMeta.length && dayMeta[index]?.excluded) {
      index += 1;
    }
    const blockEnd = index - 1;
    const hasLeaveSiblingBefore = Boolean(dayMeta[blockStart - 1] && !dayMeta[blockStart - 1].excluded);
    const hasLeaveSiblingAfter = Boolean(dayMeta[blockEnd + 1] && !dayMeta[blockEnd + 1].excluded);

    if (hasLeaveSiblingBefore && hasLeaveSiblingAfter) {
      for (let cursor = blockStart; cursor <= blockEnd; cursor += 1) {
        deducted.push(dayMeta[cursor].key);
      }
    }
  }

  return deducted;
};

const getApplicableLeaveDateKeys = ({
  fromDate,
  toDate,
  weekOffDays = [],
  holidaySet = new Set(),
  sandwichRuleEnabled,
  timeZone = "Asia/Kolkata"
}) => {
  const dayMeta = buildLeaveDayMeta({
    fromDate,
    toDate,
    weekOffDays,
    holidaySet,
    timeZone
  });
  const workingDateKeys = dayMeta.filter((day) => !day.excluded).map((day) => day.key);

  if (!sandwichRuleEnabled) {
    return workingDateKeys;
  }

  const sandwichDeductedDateKeys = getSandwichDeductedDateKeysFromDayMeta(dayMeta);
  return [...workingDateKeys, ...sandwichDeductedDateKeys].sort();
};

const analyzeLeaveDateKeys = ({
  fromDate,
  toDate,
  weekOffDays = [],
  holidaySet = new Set(),
  effectiveDateKeys = [],
  sandwichRuleEnabled,
  timeZone = "Asia/Kolkata"
}) => {
  const dayMeta = buildLeaveDayMeta({
    fromDate,
    toDate,
    weekOffDays,
    holidaySet,
    timeZone
  });
  const dayMetaByKey = new Map(dayMeta.map((day) => [day.key, day]));
  const workingDateKeys = dayMeta.filter((day) => !day.excluded).map((day) => day.key);
  const derivedEffectiveDateKeys = getApplicableLeaveDateKeys({
    fromDate,
    toDate,
    weekOffDays,
    holidaySet,
    sandwichRuleEnabled,
    timeZone
  });
  const normalizedEffectiveDateKeys = Array.isArray(effectiveDateKeys)
    ? effectiveDateKeys.filter((key) => dayMetaByKey.has(key))
    : [];
  const finalEffectiveDateKeys = normalizedEffectiveDateKeys.length
    ? [...new Set(normalizedEffectiveDateKeys)].sort()
    : derivedEffectiveDateKeys;
  const sandwichDeductedDateKeys = finalEffectiveDateKeys.filter((key) => {
    const day = dayMetaByKey.get(key);
    return Boolean(day?.excluded);
  });
  const sandwichHolidayDateKeys = sandwichDeductedDateKeys.filter((key) => dayMetaByKey.get(key)?.isHoliday);
  const sandwichWeekOffDateKeys = sandwichDeductedDateKeys.filter((key) => dayMetaByKey.get(key)?.isWeekOff);

  return {
    dayMeta,
    workingDateKeys,
    effectiveDateKeys: finalEffectiveDateKeys,
    sandwichDeductedDateKeys,
    sandwichHolidayDateKeys,
    sandwichWeekOffDateKeys
  };
};

module.exports = {
  toDateKeyInOrgTz,
  buildLeaveDayMeta,
  getApplicableLeaveDateKeys,
  analyzeLeaveDateKeys
};
