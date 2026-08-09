require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Attendance = require("../modules/timesheets/timesheetAttendance.model");
const OrgSettings = require("../modules/orgSettings/orgSettings.model");
const Organization = require("../modules/organizations/organization.model");
const { isValidTimeZone, toDateKeyInTimeZone } = require("../utils/timezone");

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const orgArg = args.find((arg) => arg.startsWith("--org="));
const orgIdFilter = orgArg ? String(orgArg.split("=")[1] || "").trim() : "";

const getOrganizationTimeZone = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId }).select("timezone").lean();
  if (isValidTimeZone(settings?.timezone)) return settings.timezone;

  const organization = await Organization.findById(organizationId).select("timezone").lean();
  if (isValidTimeZone(organization?.timezone)) return organization.timezone;

  return "Asia/Kolkata";
};

const pickFirstNonNull = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
};

const mergeGroup = (docs) => {
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

  const set = {
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
    overriddenBy: pickFirstNonNull(keeper.overriddenBy),
    overriddenAt: pickFirstNonNull(keeper.overriddenAt),
    shiftId: pickFirstNonNull(keeper.shiftId, firstCheckInRow?.shiftId),
    shiftName: pickFirstNonNull(keeper.shiftName, firstCheckInRow?.shiftName),
    shiftCode: pickFirstNonNull(keeper.shiftCode, firstCheckInRow?.shiftCode),
    shiftStartTime: pickFirstNonNull(keeper.shiftStartTime, firstCheckInRow?.shiftStartTime),
    shiftEndTime: pickFirstNonNull(keeper.shiftEndTime, firstCheckInRow?.shiftEndTime),
    scheduledStartAt: pickFirstNonNull(keeper.scheduledStartAt, firstCheckInRow?.scheduledStartAt),
    scheduledEndAt: pickFirstNonNull(keeper.scheduledEndAt, firstCheckInRow?.scheduledEndAt),
    lateByMinutes: rows.reduce((max, r) => Math.max(max, Number(r.lateByMinutes || 0)), 0),
    earlyLoginByMinutes: rows.reduce((max, r) => Math.max(max, Number(r.earlyLoginByMinutes || 0)), 0),
    earlyCheckoutByMinutes: rows.reduce((max, r) => Math.max(max, Number(r.earlyCheckoutByMinutes || 0)), 0),
    overtimeMinutes: rows.reduce((max, r) => Math.max(max, Number(r.overtimeMinutes || 0)), 0),
    missedCheckout: checkInAt && !checkOutAt,
    missedCheckoutMarkedAt: checkInAt && !checkOutAt
      ? pickFirstNonNull(
        ...rows.map((r) => r.missedCheckoutMarkedAt),
        keeper.missedCheckoutMarkedAt,
        new Date()
      )
      : null,
    missedCheckoutResolvedRequestId: checkInAt && !checkOutAt
      ? pickFirstNonNull(...rows.map((r) => r.missedCheckoutResolvedRequestId), keeper.missedCheckoutResolvedRequestId)
      : null
  };

  return {
    keeperId: keeper._id,
    duplicateIds: rows.filter((r) => String(r._id) !== String(keeper._id)).map((r) => r._id),
    set
  };
};

(async () => {
  try {
    await connectDB();

    const orgIdsRaw = orgIdFilter
      ? [orgIdFilter]
      : await Attendance.distinct("organizationId");
    const orgIds = orgIdsRaw.map((id) => String(id));

    if (orgIds.length === 0) {
      console.log("ℹ️ No attendance records found.");
      process.exit(0);
    }

    let groupsFound = 0;
    let rowsMerged = 0;
    let rowsDeleted = 0;

    for (const orgId of orgIds) {
      const timeZone = await getOrganizationTimeZone(orgId);
      const rows = await Attendance.find({ organizationId: orgId })
        .sort({ employeeId: 1, date: 1, createdAt: 1, _id: 1 })
        .lean();

      const grouped = new Map();
      for (const row of rows) {
        const employeeId = row.employeeId ? String(row.employeeId) : "";
        if (!employeeId || !row.date) continue;
        const dayKey = toDateKeyInTimeZone(row.date, timeZone);
        const key = `${employeeId}-${dayKey}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(row);
      }

      const updates = [];
      const deleteIds = [];

      for (const [, docs] of grouped.entries()) {
        if (!docs || docs.length <= 1) continue;
        groupsFound += 1;
        rowsMerged += docs.length;

        const merged = mergeGroup(docs);
        if (merged.duplicateIds.length > 0) {
          updates.push({
            updateOne: {
              filter: { _id: merged.keeperId },
              update: { $set: merged.set }
            }
          });
          deleteIds.push(...merged.duplicateIds);
        }
      }

      if (!isDryRun) {
        if (updates.length > 0) {
          await Attendance.bulkWrite(updates);
        }
        if (deleteIds.length > 0) {
          const delRes = await Attendance.deleteMany({ _id: { $in: deleteIds } });
          rowsDeleted += Number(delRes.deletedCount || 0);
        }
      } else {
        rowsDeleted += deleteIds.length;
      }

      if (groupsFound > 0) {
        console.log(
          `ℹ️ Org ${orgId} (${timeZone}): duplicate groups=${updates.length}, rowsToDelete=${deleteIds.length}`
        );
      }
    }

    if (!isDryRun) {
      await Attendance.collection.createIndex(
        { organizationId: 1, employeeId: 1, date: 1 },
        { unique: true }
      );
    }

    console.log("✅ Attendance dedupe completed");
    console.log(`   Dry run: ${isDryRun ? "yes" : "no"}`);
    console.log(`   Duplicate groups: ${groupsFound}`);
    console.log(`   Rows involved: ${rowsMerged}`);
    console.log(`   Rows deleted: ${rowsDeleted}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Attendance dedupe failed:", error?.message || error);
    process.exit(1);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
})();
