require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Attendance = require("../modules/timesheets/timesheetAttendance.model");
const OrgSettings = require("../modules/orgSettings/orgSettings.model");
const Organization = require("../modules/organizations/organization.model");
const {
  isValidTimeZone,
  toDateKeyInTimeZone,
  startOfDayInTimeZone,
  parseMonthRangeInTimeZone
} = require("../utils/timezone");

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const orgArg = args.find((arg) => arg.startsWith("--org="));
const monthArg = args.find((arg) => arg.startsWith("--month="));

const orgIdFilter = orgArg ? String(orgArg.split("=")[1] || "").trim() : "";
const monthFilter = monthArg ? String(monthArg.split("=")[1] || "").trim() : "";

if (monthFilter && !/^\d{4}-\d{2}$/.test(monthFilter)) {
  console.error("❌ Invalid --month value. Expected YYYY-MM, for example --month=2026-04");
  process.exit(1);
}

if (orgIdFilter && !mongoose.Types.ObjectId.isValid(orgIdFilter)) {
  console.error("❌ Invalid --org value. Pass a real Mongo ObjectId, for example --org=6992a1d7cd8bcedddb69d696");
  process.exit(1);
}

const getOrganizationTimeZone = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId }).select("timezone").lean();
  if (isValidTimeZone(settings?.timezone)) return settings.timezone;

  const organization = await Organization.findById(organizationId).select("timezone").lean();
  if (isValidTimeZone(organization?.timezone)) return organization.timezone;

  return "Asia/Kolkata";
};

const getAttendanceRowAnchorDate = (row) =>
  row?.checkInAt || row?.checkOutAt || row?.date || row?.createdAt || null;

const pickFirstNonNull = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
};

const getNormalizedAttendanceDate = (row, timeZone) => {
  const anchorDate = getAttendanceRowAnchorDate(row);
  if (!anchorDate) return null;
  const dateKey = toDateKeyInTimeZone(anchorDate, timeZone);
  return {
    dateKey,
    date: startOfDayInTimeZone(dateKey, timeZone)
  };
};

const buildMonthAttendanceQuery = (organizationId, start, end) => ({
  organizationId,
  $or: [
    { date: { $gte: start, $lte: end } },
    { checkInAt: { $gte: start, $lte: end } },
    { checkOutAt: { $gte: start, $lte: end } }
  ]
});

let parkingCounter = 0;
const buildParkingDate = () => {
  const value = new Date(Date.UTC(2099, 0, 1, 0, 0, parkingCounter, 0));
  parkingCounter += 1;
  return value;
};

const mergeGroup = (docs, normalizedDate) => {
  const rows = [...docs];
  const byCreatedAsc = [...rows].sort((a, b) => {
    const t1 = new Date(a.createdAt || 0).getTime();
    const t2 = new Date(b.createdAt || 0).getTime();
    if (t1 !== t2) return t1 - t2;
    return String(a._id).localeCompare(String(b._id));
  });
  const keeper = byCreatedAsc[0];

  const withCheckIn = rows
    .filter((r) => r.checkInAt)
    .sort((a, b) => new Date(a.checkInAt).getTime() - new Date(b.checkInAt).getTime());
  const withCheckOut = rows
    .filter((r) => r.checkOutAt)
    .sort((a, b) => new Date(b.checkOutAt).getTime() - new Date(a.checkOutAt).getTime());

  const firstCheckInRow = withCheckIn[0] || null;
  const lastCheckOutRow = withCheckOut[0] || null;
  const checkInAt = firstCheckInRow ? new Date(firstCheckInRow.checkInAt) : null;
  const checkOutAt = lastCheckOutRow ? new Date(lastCheckOutRow.checkOutAt) : null;

  const computedMinutes =
    checkInAt && checkOutAt
      ? Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000))
      : 0;
  const maxTotalMinutes = rows.reduce((max, row) => Math.max(max, Number(row.totalMinutes || 0)), 0);
  const totalMinutes = checkInAt && checkOutAt ? Math.max(maxTotalMinutes, computedMinutes) : maxTotalMinutes;

  return {
    keeperId: keeper._id,
    duplicateIds: rows.filter((r) => String(r._id) !== String(keeper._id)).map((r) => r._id),
    set: {
      date: normalizedDate,
      checkInAt: checkInAt || null,
      checkOutAt: checkOutAt || null,
      totalMinutes: Number(totalMinutes || 0),
      status: checkInAt && checkOutAt ? "checked_out" : "checked_in",
      checkInIp: pickFirstNonNull(firstCheckInRow?.checkInIp, keeper.checkInIp),
      checkInLatitude: Number.isFinite(firstCheckInRow?.checkInLatitude)
        ? Number(firstCheckInRow.checkInLatitude)
        : (Number.isFinite(keeper.checkInLatitude) ? Number(keeper.checkInLatitude) : null),
      checkInLongitude: Number.isFinite(firstCheckInRow?.checkInLongitude)
        ? Number(firstCheckInRow.checkInLongitude)
        : (Number.isFinite(keeper.checkInLongitude) ? Number(keeper.checkInLongitude) : null),
      checkInSelfieProvided: Boolean(rows.some((r) => r.checkInSelfieProvided)),
      checkInSelfieImage: pickFirstNonNull(firstCheckInRow?.checkInSelfieImage, keeper.checkInSelfieImage),
      overriddenBy: pickFirstNonNull(keeper.overriddenBy, ...rows.map((r) => r.overriddenBy)),
      overriddenAt: pickFirstNonNull(keeper.overriddenAt, ...rows.map((r) => r.overriddenAt)),
      shiftId: pickFirstNonNull(keeper.shiftId, firstCheckInRow?.shiftId, ...rows.map((r) => r.shiftId)),
      shiftName: pickFirstNonNull(keeper.shiftName, firstCheckInRow?.shiftName, ...rows.map((r) => r.shiftName)),
      shiftCode: pickFirstNonNull(keeper.shiftCode, firstCheckInRow?.shiftCode, ...rows.map((r) => r.shiftCode)),
      shiftStartTime: pickFirstNonNull(
        keeper.shiftStartTime,
        firstCheckInRow?.shiftStartTime,
        ...rows.map((r) => r.shiftStartTime)
      ),
      shiftEndTime: pickFirstNonNull(
        keeper.shiftEndTime,
        firstCheckInRow?.shiftEndTime,
        ...rows.map((r) => r.shiftEndTime)
      ),
      scheduledStartAt: pickFirstNonNull(
        keeper.scheduledStartAt,
        firstCheckInRow?.scheduledStartAt,
        ...rows.map((r) => r.scheduledStartAt)
      ),
      scheduledEndAt: pickFirstNonNull(
        keeper.scheduledEndAt,
        firstCheckInRow?.scheduledEndAt,
        ...rows.map((r) => r.scheduledEndAt)
      ),
      lateByMinutes: rows.reduce((max, r) => Math.max(max, Number(r.lateByMinutes || 0)), 0),
      earlyLoginByMinutes: rows.reduce((max, r) => Math.max(max, Number(r.earlyLoginByMinutes || 0)), 0),
      earlyCheckoutByMinutes: rows.reduce((max, r) => Math.max(max, Number(r.earlyCheckoutByMinutes || 0)), 0),
      overtimeMinutes: rows.reduce((max, r) => Math.max(max, Number(r.overtimeMinutes || 0)), 0),
      missedCheckout: Boolean(checkInAt && !checkOutAt),
      missedCheckoutMarkedAt: checkInAt && !checkOutAt
        ? pickFirstNonNull(
          ...rows.map((r) => r.missedCheckoutMarkedAt),
          keeper.missedCheckoutMarkedAt,
          new Date()
        )
        : null,
      missedCheckoutResolvedRequestId: checkInAt && !checkOutAt
        ? pickFirstNonNull(
          ...rows.map((r) => r.missedCheckoutResolvedRequestId),
          keeper.missedCheckoutResolvedRequestId
        )
        : null
    }
  };
};

(async () => {
  try {
    await connectDB();

    const orgIdsRaw = orgIdFilter
      ? [orgIdFilter]
      : await Attendance.distinct("organizationId");
    const orgIds = orgIdsRaw.map((id) => String(id)).filter(Boolean);

    if (orgIds.length === 0) {
      console.log("ℹ️ No attendance records found.");
      process.exit(0);
    }

    let totalOrgsProcessed = 0;
    let totalRowsScanned = 0;
    let totalRowsMatched = 0;
    let totalRowsUpdated = 0;
    let totalGroupsMerged = 0;
    let totalRowsDeleted = 0;

    for (const orgId of orgIds) {
      const timeZone = await getOrganizationTimeZone(orgId);
      const targetMonth = monthFilter || toDateKeyInTimeZone(new Date(), timeZone).slice(0, 7);
      const { start, end } = parseMonthRangeInTimeZone(targetMonth, timeZone);

      const rows = await Attendance.find(buildMonthAttendanceQuery(orgId, start, end))
        .sort({ employeeId: 1, date: 1, checkInAt: 1, _id: 1 })
        .lean();

      totalOrgsProcessed += 1;
      totalRowsScanned += rows.length;

      const singleRowPlans = [];
      const mergePlans = [];
      const samples = [];
      const groups = new Map();

      for (const row of rows) {
        const normalized = getNormalizedAttendanceDate(row, timeZone);
        if (!normalized?.date || !normalized?.dateKey) continue;
        if (!normalized.dateKey.startsWith(`${targetMonth}-`)) continue;

        const employeeId = row?.employeeId ? String(row.employeeId) : "";
        if (!employeeId) continue;
        const groupKey = `${employeeId}-${normalized.dateKey}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            normalized,
            rows: []
          });
        }
        groups.get(groupKey).rows.push(row);
      }

      for (const [, group] of groups.entries()) {
        const { normalized, rows: groupedRows } = group;
        if (!groupedRows.length) continue;

        if (groupedRows.length === 1) {
          const row = groupedRows[0];
          const currentDate = row?.date ? new Date(row.date) : null;
          if (!currentDate || Number.isNaN(currentDate.getTime())) continue;
          if (currentDate.getTime() === normalized.date.getTime()) continue;

          totalRowsMatched += 1;
          singleRowPlans.push({
            keeperId: row._id,
            currentDate,
            set: {
              date: normalized.date
            },
            duplicateIds: []
          });

          if (samples.length < 10) {
            samples.push({
              type: "update",
              attendanceId: String(row._id),
              employeeId: String(row.employeeId),
              from: row.date instanceof Date ? row.date.toISOString() : new Date(row.date).toISOString(),
              to: normalized.date.toISOString(),
              anchor: getAttendanceRowAnchorDate(row)
            });
          }
          continue;
        }

        const mergePlan = mergeGroup(groupedRows, normalized.date);
        const keeperRow = groupedRows.find((row) => String(row._id) === String(mergePlan.keeperId)) || groupedRows[0];
        mergePlan.currentDate = keeperRow?.date ? new Date(keeperRow.date) : new Date(mergePlan.set.date);
        const needsKeeperUpdate =
          new Date(mergePlan.set.date).getTime() !== new Date(keeperRow?.date || mergePlan.set.date).getTime()
          || mergePlan.duplicateIds.length > 0
          || groupedRows.some((row) => {
            const currentDate = row?.date ? new Date(row.date) : null;
            return currentDate && currentDate.getTime() !== normalized.date.getTime();
          });

        if (!needsKeeperUpdate) continue;

        totalRowsMatched += groupedRows.length;
        totalGroupsMerged += 1;
        mergePlans.push(mergePlan);

        if (samples.length < 10) {
          samples.push({
            type: "merge",
            attendanceId: String(mergePlan.keeperId),
            employeeId: String(groupedRows[0].employeeId),
            from: groupedRows
              .map((row) => (row.date instanceof Date ? row.date.toISOString() : new Date(row.date).toISOString()))
              .join(","),
            to: normalized.date.toISOString(),
            anchor: getAttendanceRowAnchorDate(groupedRows[0]),
            duplicateCount: mergePlan.duplicateIds.length
          });
        }
      }

      const survivorPlans = [...singleRowPlans, ...mergePlans];
      const parkingPlans = survivorPlans
        .filter((plan) => {
          const currentDate = plan.currentDate ? new Date(plan.currentDate) : null;
          const finalDate = plan?.set?.date ? new Date(plan.set.date) : null;
          if (!currentDate || !finalDate) return false;
          if (Number.isNaN(currentDate.getTime()) || Number.isNaN(finalDate.getTime())) return false;
          return currentDate.getTime() !== finalDate.getTime();
        })
        .map((plan) => ({
          keeperId: plan.keeperId,
          parkingDate: buildParkingDate()
        }));

      const duplicateIdsToDelete = mergePlans.flatMap((plan) => plan.duplicateIds);

      if (!isDryRun) {
        if (parkingPlans.length > 0) {
          await Attendance.bulkWrite(
            parkingPlans.map((plan) => ({
              updateOne: {
                filter: { _id: plan.keeperId },
                update: {
                  $set: {
                    date: plan.parkingDate
                  }
                }
              }
            })),
            { ordered: false }
          );
        }

        if (duplicateIdsToDelete.length > 0) {
          const deleteResult = await Attendance.deleteMany({
            _id: { $in: duplicateIdsToDelete }
          });
          totalRowsDeleted += Number(deleteResult.deletedCount || 0);
        }

        if (survivorPlans.length > 0) {
          await Attendance.bulkWrite(
            survivorPlans.map((plan) => ({
              updateOne: {
                filter: { _id: plan.keeperId },
                update: { $set: plan.set }
              }
            })),
            { ordered: false }
          );
          totalRowsUpdated += survivorPlans.length;
        }
      } else {
        totalRowsUpdated += survivorPlans.length;
        totalRowsDeleted += duplicateIdsToDelete.length;
      }

      console.log(
        `ℹ️ Org ${orgId} (${timeZone}) month ${targetMonth}: scanned=${rows.length}, singleUpdates=${singleRowPlans.length}, mergeGroups=${mergePlans.length}, parked=${parkingPlans.length}, ${isDryRun ? "wouldUpdate" : "updated"}=${survivorPlans.length}, ${isDryRun ? "wouldDelete" : "deleted"}=${duplicateIdsToDelete.length}`
      );

      if (samples.length > 0) {
        samples.forEach((sample) => {
          const anchorText = sample.anchor ? new Date(sample.anchor).toISOString() : "n/a";
          console.log(
            `   - ${sample.type} attendance=${sample.attendanceId} employee=${sample.employeeId} from=${sample.from} to=${sample.to} anchor=${anchorText}${sample.duplicateCount !== undefined ? ` duplicates=${sample.duplicateCount}` : ""}`
          );
        });
      }
    }

    console.log("✅ Attendance month-date migration completed");
    console.log(`   Dry run: ${isDryRun ? "yes" : "no"}`);
    console.log(`   Orgs processed: ${totalOrgsProcessed}`);
    console.log(`   Rows scanned: ${totalRowsScanned}`);
    console.log(`   Rows matched: ${totalRowsMatched}`);
    console.log(`   Merge groups: ${totalGroupsMerged}`);
    console.log(`   Rows ${isDryRun ? "that would be deleted" : "deleted"}: ${totalRowsDeleted}`);
    console.log(`   Rows ${isDryRun ? "that would be updated" : "updated"}: ${totalRowsUpdated}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Attendance month-date migration failed:", error?.message || error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
})();
