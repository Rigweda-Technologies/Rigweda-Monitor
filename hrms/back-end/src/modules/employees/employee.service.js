const mongoose = require("mongoose");
const { once } = require("events");
const User = require("../users/user.model");
const OrgUser = require("../organizations/org-user.model");
const Employee = require("./employee.model");
const OrganizationService = require('../organizations/organization.service');
const Role = require("../roles/role.model");
const ApprovalFlow = require("../approvalFlows/approvalFlow.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const { getPayrollPgPool } = require("../../config/payrollDb");
const { genHashedPassword } = require("../../utils/bcryptUtils");
const sendMail = require("../../utils/sendMail");
const leaveBalanceService =
  require("../leaveBalances/leaveBalance.service");
const { createNotificationSafe } = require("../notifications/notification.service");
const { uploadDataUri } = require("../../config/cloudinary");

const DEFAULT_PROBATION_DAYS = 90;
const DEFAULT_NOTICE_DAYS = 30;
const LIFECYCLE_ACTION_ROLE_SLUGS = new Set([
  "teamlead",
  "team-lead",
  "team_lead",
  "lead",
  "manager",
  "hr",
  "admin",
  "org-admin",
  "super_admin",
  "superadmin"
]);
const EMPLOYEE_STATUS_ADMIN_ROLE_SLUGS = new Set([
  "admin",
  "org-admin",
  "orgadmin",
  "super_admin",
  "superadmin"
]);

const normalizeEmployeeCode = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim().toUpperCase();
};

const buildReleasedEmail = ({ email, employeeId }) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const [localPart, domainPart] = normalizedEmail.split("@");
  const suffix = `${employeeId || "employee"}-${Date.now()}`;

  if (!localPart || !domainPart) {
    return `deleted-${suffix}@deleted.local`;
  }

  return `${localPart}+deleted-${suffix}@${domainPart}`;
};

const toObjectId = (value) => {
  if (!value) return value;
  if (value instanceof mongoose.Types.ObjectId) return value;
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
};

const releaseUserEmail = async ({ user, employeeId, organizationId, session }) => {
  if (!user) return;

  const originalEmail = user.email;
  user.email = buildReleasedEmail({ email: originalEmail, employeeId });
  user.status = "inactive";
  user.softDeleteMeta = {
    organizationId,
    originalEmail,
    deletedAt: new Date()
  };
  user.organizationIds = (user.organizationIds || []).filter(
    (orgId) => String(orgId) !== String(organizationId)
  );
  if (String(user.activeOrganizationId || "") === String(organizationId)) {
    user.activeOrganizationId = user.organizationIds[0] || undefined;
  }
  await user.save(session ? { session } : undefined);
};

const toNameCase = (value) => {
  if (value === undefined || value === null) return value;
  const text = String(value).trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text
    .split(" ")
    .map((part) =>
      part
        .split("-")
        .map((segment) =>
          segment ? `${segment.charAt(0).toUpperCase()}${segment.slice(1).toLowerCase()}` : segment
        )
        .join("-")
    )
    .join(" ");
};

const deriveNamePartsFromEmail = (email) => {
  const localPart = String(email || "").split("@")[0] || "";
  const tokens = localPart
    .split(/[._-]+/)
    .map((part) => toNameCase(part))
    .filter(Boolean);

  return {
    firstName: tokens[0] || "Organization",
    lastName: tokens.slice(1).join(" ") || "Admin"
  };
};

const syncEmployeePayrollStatus = async ({ organizationId, employeeId, payrollStatus }) => {
  const pool = await getPayrollPgPool();
  if (!pool || !organizationId || !employeeId || !payrollStatus) return;

  const client = await pool.connect();
  try {
    const tenantResult = await client.query(
      `SELECT id FROM payroll_tenants WHERE organization_id = $1 LIMIT 1`,
      [String(organizationId)]
    );
    const tenantId = tenantResult.rows[0]?.id;
    if (!tenantId) return;

    await client.query(
      `
        UPDATE employee_payroll_profiles
        SET payroll_status = $3
        WHERE tenant_id = $1
          AND employee_external_id = $2
      `,
      [tenantId, String(employeeId), payrollStatus]
    );
  } finally {
    client.release();
  }
};

const ensureEmployeeRecordForOrgUser = async ({
  organizationId,
  userId
}) => {
  if (!organizationId || !userId) return null;

  let employee = await Employee.findOne({
    userId,
    organizationId,
    isDeleted: false
  });
  if (employee) return employee;

  const [user, existingEmployee] = await Promise.all([
    User.findById(userId).select("email"),
    Employee.findOne({ userId }).sort({ createdAt: -1 })
  ]);

  const derivedName = deriveNamePartsFromEmail(user?.email || "");
  const generatedEmployeeCode = await generateEmployeeCode(organizationId);

  const basePayload = {
    organizationId,
    userId,
    firstName: toNameCase(existingEmployee?.firstName || derivedName.firstName || "Organization"),
    lastName: toNameCase(existingEmployee?.lastName || derivedName.lastName || "Admin"),
    employeeCode: generatedEmployeeCode,
    departmentId: existingEmployee?.departmentId || undefined,
    designationId: existingEmployee?.designationId || undefined,
    dateOfJoining: existingEmployee?.dateOfJoining || new Date(),
    employmentType: existingEmployee?.employmentType || "full_time",
    managerId: existingEmployee?.managerId || undefined,
    shiftId: existingEmployee?.shiftId || undefined,
    phone: existingEmployee?.phone || "",
    dob: existingEmployee?.dob || undefined,
    gender: existingEmployee?.gender || "",
    bloodGroup: existingEmployee?.bloodGroup || "",
    address: existingEmployee?.address || undefined,
    emergencyContacts: existingEmployee?.emergencyContacts || [],
    profileImage: existingEmployee?.profileImage || null,
    addressProof: existingEmployee?.addressProof || null,
    aadhaarNumber: existingEmployee?.aadhaarNumber || null,
    panNumber: existingEmployee?.panNumber || null,
    aadhaarProof: existingEmployee?.aadhaarProof || null,
    panProof: existingEmployee?.panProof || null,
    leaveApprovalFlowId: existingEmployee?.leaveApprovalFlowId || null,
    attendanceApprovalFlowId: existingEmployee?.attendanceApprovalFlowId || null,
    profileCompleted: existingEmployee?.profileCompleted || false,
    status: existingEmployee?.status || "active",
    employmentLifecycleStatus: existingEmployee?.employmentLifecycleStatus || "confirmed"
  };

  if (existingEmployee) {
    const orgChanged = String(existingEmployee.organizationId || "") !== String(organizationId);
    existingEmployee.set(basePayload);
    await existingEmployee.save();
    if (orgChanged) {
      await leaveBalanceService.initializeForEmployee(existingEmployee, organizationId);
    }
    return existingEmployee;
  }

  employee = await Employee.create(basePayload);
  await leaveBalanceService.initializeForEmployee(employee, organizationId);
  return employee;
};

/* ------------------------------------------------------------------ */
/* HR / ADMIN CREATES EMPLOYEE                                         */
/* ------------------------------------------------------------------ */
exports.createByHr = async (req) => {
  const createFlow = async (options = {}) => {
    const { session } = options;
    const useSession = Boolean(session);

    const {
      email,
      roleIds,
      firstName,
      lastName,
      employeeCode,
      departmentId,
      designationId,
      dateOfJoining,
      employmentType,
      managerId,
      leaveApprovalFlowId,
      attendanceApprovalFlowId,
      shiftId
    } = req.body;

    const { organizationId } = req.user;
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedFirstName = toNameCase(firstName);
    const normalizedLastName = toNameCase(lastName);

    let existingUser = useSession
      ? await User.findOne({ email: normalizedEmail }, null, { session })
      : await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      const deletedEmployee = await Employee.collection.findOne(
        {
          userId: existingUser._id,
          organizationId: toObjectId(organizationId),
          isDeleted: true
        },
        useSession ? { session } : undefined
      );

      if (!deletedEmployee) {
        throw { code: 409, message: "User already exists" };
      }

      await releaseUserEmail({
        user: existingUser,
        employeeId: deletedEmployee._id,
        organizationId,
        session: useSession ? session : undefined
      });
      existingUser = null;
    }

    const plainPassword = generatePassword();
    const hashedPassword = await genHashedPassword(plainPassword);

    const [user] = useSession
      ? await User.create(
          [
            {
              organizationIds: [organizationId],
              activeOrganizationId: organizationId,
              email: normalizedEmail,
              password: hashedPassword,
              status: "active",
              passwordChangeRequired: true
            }
          ],
          { session }
        )
      : await User.create([
          {
            organizationIds: [organizationId],
            activeOrganizationId: organizationId,
            email: normalizedEmail,
            password: hashedPassword,
            status: "active",
            passwordChangeRequired: true
          }
        ]);

    const orgUsers = useSession
      ? await OrgUser.create(
          [
            {
              userId: user._id,
              organizationId,
              roleIds
            }
          ],
          { session }
        )
      : await OrgUser.create([
          {
            userId: user._id,
            organizationId,
            roleIds
          }
        ]);

    const requestedEmployeeCode = normalizeEmployeeCode(employeeCode);
    let resolvedEmployeeCode = requestedEmployeeCode;
    if (resolvedEmployeeCode) {
      const employeeCodeExists = useSession
        ? await Employee.findOne(
            { organizationId, employeeCode: resolvedEmployeeCode },
            "_id",
            { session }
          )
        : await Employee.findOne({ organizationId, employeeCode: resolvedEmployeeCode }, "_id");
      if (employeeCodeExists) {
        throw { code: 409, message: "Employee code already exists" };
      }
    } else {
      resolvedEmployeeCode = await generateEmployeeCode(
        organizationId,
        useSession ? session : undefined
      );
    }
    const orgSettings = useSession
      ? await OrgSettings.findOne({ organizationId }, null, { session })
      : await OrgSettings.findOne({ organizationId });
    const lifecyclePayload = buildProbationLifecyclePayload({
      dateOfJoining,
      probationPeriodDays: orgSettings?.probationPeriodDays,
      noticePeriodDays: orgSettings?.noticePeriodDays
    });
    const resolvedLeaveApprovalFlowId = await resolveAssignedApprovalFlowId({
      organizationId,
      moduleKey: "leave",
      flowId: leaveApprovalFlowId
    });
    const resolvedAttendanceApprovalFlowId = await resolveAssignedApprovalFlowId({
      organizationId,
      moduleKey: "attendance_request",
      flowId: attendanceApprovalFlowId
    });

    const [employee] = useSession
      ? await Employee.create(
          [
            {
              organizationId,
              userId: user._id,
              firstName: normalizedFirstName,
              lastName: normalizedLastName,
              employeeCode: resolvedEmployeeCode,
              departmentId,
              designationId,
              dateOfJoining,
              employmentType,
              managerId,
              leaveApprovalFlowId: resolvedLeaveApprovalFlowId,
              attendanceApprovalFlowId: resolvedAttendanceApprovalFlowId,
              shiftId: shiftId || undefined,
              profileCompleted: false,
              ...lifecyclePayload
            }
          ],
          { session }
        )
      : await Employee.create([
          {
            organizationId,
            userId: user._id,
            firstName: normalizedFirstName,
            lastName: normalizedLastName,
            employeeCode: resolvedEmployeeCode,
            departmentId,
            designationId,
            dateOfJoining,
            employmentType,
            managerId,
            leaveApprovalFlowId: resolvedLeaveApprovalFlowId,
            attendanceApprovalFlowId: resolvedAttendanceApprovalFlowId,
            shiftId: shiftId || undefined,
            profileCompleted: false,
            ...lifecyclePayload
          }
        ]);

    await leaveBalanceService.initializeForEmployee(
      employee,
      req.user.organizationId
    );

    const orgDetails = await OrganizationService.getOrganizationById(organizationId);
    await sendMail(
      "employeeOnboarding",
      normalizedFirstName,
      `Welcome to ${orgDetails?.name}`,
      {
        employeeName: normalizedFirstName,
        email,
        password: plainPassword,
        loginUrl: process.env.FRONTEND_LOGIN_URL,
        orgName: orgDetails?.name
      },
      email
    );

    return {
      employeeId: employee._id,
      userId: user._id,
      email
    };
  };

  const session = await mongoose.startSession();

  try {
    try {
      session.startTransaction();
      const result = await createFlow({ session });
      await session.commitTransaction();
      session.endSession();
      return result;
    } catch (err) {
      const message = err?.message || "";
      const codeName = err?.codeName || "";
      const isTxnError =
        codeName === "IllegalOperation" ||
        message.includes("Transaction numbers are only allowed");

      if (isTxnError) {
        try {
          await session.abortTransaction();
        } catch (_) {}
        session.endSession();
        return await createFlow({});
      }

      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      session.endSession();
      throw err;
    }
  } catch (err) {
    session.endSession();
    throw err;
  }
};

/* ------------------------------------------------------------------ */
/* EMPLOYEE COMPLETES OWN PROFILE                                      */
/* ------------------------------------------------------------------ */
exports.completeMyProfile = async (req) => {
  const employee = await ensureEmployeeRecordForOrgUser({
    organizationId: req.user.organizationId,
    userId: req.user.userId
  });

  const editableFields = {
    phone: req.body.phone,
    dob: req.body.dob,
    gender: req.body.gender,
    bloodGroup: req.body.bloodGroup ? String(req.body.bloodGroup).trim().toUpperCase() : req.body.bloodGroup,
    aadhaarNumber: req.body.aadhaarNumber,
    panNumber: req.body.panNumber ? String(req.body.panNumber).trim().toUpperCase() : req.body.panNumber,
    address: req.body.address,
    emergencyContacts: req.body.emergencyContacts
  };

  if (req.body.profileImageUpload?.base64Data && req.body.profileImageUpload?.mimeType) {
    const imageDataUri = `data:${req.body.profileImageUpload.mimeType};base64,${req.body.profileImageUpload.base64Data}`;
    const uploadedImage = await uploadDataUri(imageDataUri, {
      folder: "hrms/employee-profile-images"
    });
    editableFields.profileImage = uploadedImage?.secure_url || null;
  }

  if (req.body.addressProofUpload?.base64Data && req.body.addressProofUpload?.mimeType) {
    const proofDataUri = `data:${req.body.addressProofUpload.mimeType};base64,${req.body.addressProofUpload.base64Data}`;
    const uploadedProof = await uploadDataUri(proofDataUri, {
      folder: "hrms/employee-address-proofs"
    });
    editableFields.addressProof = {
      fileName: req.body.addressProofUpload.fileName || "address-proof",
      fileUrl: uploadedProof?.secure_url || "",
      mimeType: req.body.addressProofUpload.mimeType || "",
      uploadedAt: new Date()
    };
  }

  if (req.body.aadhaarProofUpload?.base64Data && req.body.aadhaarProofUpload?.mimeType) {
    const aadhaarDataUri = `data:${req.body.aadhaarProofUpload.mimeType};base64,${req.body.aadhaarProofUpload.base64Data}`;
    const uploadedAadhaar = await uploadDataUri(aadhaarDataUri, {
      folder: "hrms/employee-aadhaar-proofs"
    });
    editableFields.aadhaarProof = {
      fileName: req.body.aadhaarProofUpload.fileName || "aadhaar-proof",
      fileUrl: uploadedAadhaar?.secure_url || "",
      mimeType: req.body.aadhaarProofUpload.mimeType || "",
      uploadedAt: new Date()
    };
  }

  if (req.body.panProofUpload?.base64Data && req.body.panProofUpload?.mimeType) {
    const panDataUri = `data:${req.body.panProofUpload.mimeType};base64,${req.body.panProofUpload.base64Data}`;
    const uploadedPan = await uploadDataUri(panDataUri, {
      folder: "hrms/employee-pan-proofs"
    });
    editableFields.panProof = {
      fileName: req.body.panProofUpload.fileName || "pan-proof",
      fileUrl: uploadedPan?.secure_url || "",
      mimeType: req.body.panProofUpload.mimeType || "",
      uploadedAt: new Date()
    };
  }

  Object.assign(employee, editableFields);
  employee.profileCompleted = true;

  await employee.save();
  const employeeObj = employee.toObject();
  return {
    ...employeeObj,
    firstName: toNameCase(employeeObj.firstName),
    lastName: toNameCase(employeeObj.lastName)
  };
};

/* ------------------------------------------------------------------ */
/* HELPERS                                                            */
/* ------------------------------------------------------------------ */
function generatePassword() {
  return Math.random().toString(36).slice(-10);
}

const addDays = (value, days) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
};

const normalizeDateOnly = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const normalizeNonNegativeNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const buildProbationLifecyclePayload = ({
  dateOfJoining,
  probationPeriodDays,
  noticePeriodDays
}) => {
  const joiningDate = new Date(dateOfJoining);
  const probationDays = normalizeNonNegativeNumber(
    probationPeriodDays,
    DEFAULT_PROBATION_DAYS
  );
  const noticeDays = normalizeNonNegativeNumber(
    noticePeriodDays,
    DEFAULT_NOTICE_DAYS
  );

  return {
    employmentLifecycleStatus: "probation",
    probationPeriodDays: probationDays,
    probationStartDate: joiningDate,
    probationEndDate: addDays(joiningDate, probationDays),
    probationCompletedAt: null,
    probationCompletionNotifiedAt: null,
    noticePeriodDays: noticeDays,
    noticeStartDate: null,
    noticeEndDate: null,
    lastWorkingDay: null,
    benefitsEligible: false
  };
};

const resolveAssignedApprovalFlowId = async ({
  organizationId,
  moduleKey,
  flowId
}) => {
  if (!flowId) return null;

  const flow = await ApprovalFlow.findOne({
    _id: flowId,
    organizationId,
    moduleKey,
    isActive: true
  }).select("_id");

  if (!flow) {
    const moduleLabel = moduleKey === "leave" ? "leave" : "attendance request";
    throw {
      code: 400,
      message: `Selected ${moduleLabel} approval flow is invalid or inactive`
    };
  }

  return flow._id;
};

const applyLifecycleChange = (employee, nextLifecycleStatus, options = {}) => {
  if (!nextLifecycleStatus) return;

  const now = new Date();
  const noticeDays = normalizeNonNegativeNumber(
    employee.noticePeriodDays,
    DEFAULT_NOTICE_DAYS
  );
  const providedLastWorkingDay = Object.prototype.hasOwnProperty.call(options, "lastWorkingDay")
    ? normalizeDateOnly(options.lastWorkingDay)
    : undefined;
  const providedConfirmedDate = Object.prototype.hasOwnProperty.call(options, "confirmedDate")
    ? normalizeDateOnly(options.confirmedDate)
    : undefined;

  if (nextLifecycleStatus === "probation") {
    const probationDays = normalizeNonNegativeNumber(
      employee.probationPeriodDays,
      DEFAULT_PROBATION_DAYS
    );
    const baseStartDate = employee.probationStartDate || employee.dateOfJoining || now;
    employee.employmentLifecycleStatus = "probation";
    employee.probationPeriodDays = probationDays;
    employee.probationStartDate = new Date(baseStartDate);
    employee.probationEndDate = addDays(baseStartDate, probationDays);
    employee.probationCompletedAt = null;
    employee.probationCompletionNotifiedAt = null;
    employee.noticeStartDate = null;
    employee.noticeEndDate = null;
    employee.lastWorkingDay = null;
    employee.benefitsEligible = false;
    return;
  }

  if (nextLifecycleStatus === "confirmed") {
    employee.employmentLifecycleStatus = "confirmed";
    if (Object.prototype.hasOwnProperty.call(options, "confirmedDate")) {
      employee.probationCompletedAt = providedConfirmedDate;
      employee.confirmedDate = providedConfirmedDate;
    } else {
      employee.probationCompletedAt = employee.probationCompletedAt || now;
      employee.confirmedDate = employee.confirmedDate || now;
    }
    employee.noticeStartDate = null;
    employee.noticeEndDate = null;
    employee.lastWorkingDay = null;
    employee.benefitsEligible = true;
    return;
  }

  if (nextLifecycleStatus === "notice") {
    const resolvedLastWorkingDay = providedLastWorkingDay ?? addDays(now, noticeDays);
    employee.employmentLifecycleStatus = "notice";
    employee.noticePeriodDays = noticeDays;
    employee.noticeStartDate = now;
    employee.noticeEndDate = resolvedLastWorkingDay;
    employee.lastWorkingDay = resolvedLastWorkingDay;
    employee.benefitsEligible = false;
    return;
  }

  if (nextLifecycleStatus === "terminated") {
    employee.employmentLifecycleStatus = "terminated";
    employee.noticeStartDate = null;
    employee.noticeEndDate = null;
    employee.lastWorkingDay = providedLastWorkingDay ?? employee.lastWorkingDay ?? null;
    employee.benefitsEligible = false;
  }
};

const getActorRoleSlug = async (req) => {
  if (!req.user.activeRoleId) return "";

  const scopedRole = await Role.findOne({
    _id: req.user.activeRoleId,
    organizationId: req.user.organizationId
  }).select("slug");

  if (scopedRole?.slug) return scopedRole.slug;

  const fallbackRole = await Role.findById(req.user.activeRoleId).select("slug");
  return fallbackRole?.slug || "";
};

const ensureCanChangeEmployeeActiveState = async (req) => {
  const roleSlug = String(await getActorRoleSlug(req)).trim().toLowerCase();
  if (!EMPLOYEE_STATUS_ADMIN_ROLE_SLUGS.has(roleSlug)) {
    throw { code: 403, message: "Only admin can activate or inactivate employees" };
  }
};

const buildEmployeeResponse = async ({ employeeId, organizationId }) => {
  const populatedEmployee = await Employee.findOne({
    _id: employeeId,
    organizationId,
    isDeleted: false
  })
    .populate("departmentId", "name")
    .populate("designationId", "name")
    .populate("managerId", "firstName lastName")
    .populate("leaveApprovalFlowId", "name moduleKey")
    .populate("attendanceApprovalFlowId", "name moduleKey")
    .populate("shiftId", "name code startTime endTime graceMinutes status")
    .populate("userId", "email");

  const orgUser = await OrgUser.findOne({
    userId: populatedEmployee.userId?._id || populatedEmployee.userId,
    organizationId
  }).populate("roleIds", "name");

  const employeeObj = populatedEmployee.toObject();
  return {
    ...employeeObj,
    firstName: toNameCase(employeeObj.firstName),
    lastName: toNameCase(employeeObj.lastName),
    roleIds: orgUser?.roleIds || []
  };
};

async function generateEmployeeCode(organizationId, session) {
  const orgSettings = session
    ? await OrgSettings.findOne({ organizationId }, "employeeIdPrefix", { session }).lean()
    : await OrgSettings.findOne({ organizationId }, "employeeIdPrefix").lean();
  const envPrefix = (process.env.EMPLOYEE_ID_PREFIX || process.env.EMPLOYEE_CODE_PREFIX || "LV").trim();
  const prefix = ((orgSettings?.employeeIdPrefix || envPrefix || "LV").trim() || "LV").toUpperCase();
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const codePattern = new RegExp(`^${escapedPrefix}-(\\d+)$`, "i");
  const employeeCodeAggregate = Employee.aggregate([
    {
      $match: {
        organizationId: typeof organizationId === "string" ? new mongoose.Types.ObjectId(organizationId) : organizationId,
        employeeCode: { $regex: `^${escapedPrefix}-`, $options: "i" }
      }
    },
    {
      $project: {
        employeeCode: 1
      }
    }
  ]);
  if (session) {
    employeeCodeAggregate.session(session);
  }
  const existingEmployees = await employeeCodeAggregate;

  let sequence = existingEmployees.reduce((max, row) => {
    const match = codePattern.exec(String(row?.employeeCode || ""));
    if (!match) return max;
    const current = Number(match[1]);
    return Number.isFinite(current) ? Math.max(max, current) : max;
  }, 0);

  while (true) {
    sequence += 1;
    const code = `${prefix}-${String(sequence).padStart(4, "0")}`;
    const exists = await Employee.findOne(
      { organizationId, employeeCode: code },
      "_id",
      { session }
    );
    if (!exists) return code;
  }
}

const EMPLOYEE_ALLOWED_SORT_FIELDS = new Set([
  "createdAt",
  "firstName",
  "lastName",
  "employeeCode",
  "dateOfJoining",
  "status",
  "employmentLifecycleStatus"
]);

const toCsvValue = (value) => {
  const normalized = String(value ?? "");
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, "\"\"")}"`;
};

const toDateValue = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const buildEmployeeListContext = async (req) => {
  const {
    search,
    departmentId,
    designationId,
    status,
    employeeState,
    managerId,
    employmentType,
    organizationId: orgIdOverride,
    sortBy,
    sortOrder
  } = req.query;
  const { organizationId, userId, activeRoleId } = req.user;

  const isSuperAdmin = await OrganizationService.isUserSuperAdmin(userId);
  const effectiveOrganizationId = isSuperAdmin && orgIdOverride ? orgIdOverride : organizationId;

  let activeRoleSlug = "";
  if (activeRoleId) {
    const role = await Role.findOne({
      _id: activeRoleId,
      organizationId
    }).select("slug");
    activeRoleSlug = role?.slug || "";
  }

  const includeDeleted =
    activeRoleSlug !== "employee" &&
    (employeeState === "inactive" || employeeState === "all");
  const query = {
    organizationId: effectiveOrganizationId,
    ...(includeDeleted ? {} : { isDeleted: false })
  };

  if (activeRoleSlug === "employee") {
    const currentEmployee = await Employee.findOne({
      userId,
      organizationId,
      isDeleted: false
    }).select("_id managerId");

    if (currentEmployee?.managerId) {
      const teamEmployees = await Employee.find({
        organizationId,
        isDeleted: false,
        managerId: currentEmployee.managerId,
        status: { $ne: "resigned" },
        employmentLifecycleStatus: { $ne: "terminated" }
      }).select("_id");

      query._id = {
        $in: [
          currentEmployee.managerId,
          ...teamEmployees.map((employee) => employee._id)
        ]
      };
      query.status = { $ne: "resigned" };
      query.employmentLifecycleStatus = { $ne: "terminated" };
    } else if (currentEmployee) {
      query._id = currentEmployee._id;
      query.status = { $ne: "resigned" };
      query.employmentLifecycleStatus = { $ne: "terminated" };
    } else {
      query._id = { $in: [] };
    }
  } else if (activeRoleSlug === "manager") {
    const managerEmployee = await Employee.findOne({
      userId,
      organizationId
    }).select("_id");
    if (managerEmployee) query.managerId = managerEmployee._id;
  }

  if (search) {
    const matchingUsers = await User.find({
      email: { $regex: search, $options: "i" }
    }).select("_id");
    const matchingUserIds = matchingUsers.map((user) => user._id);

    query.$or = [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { employeeCode: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      ...(matchingUserIds.length ? [{ userId: { $in: matchingUserIds } }] : [])
    ];
  }

  if (departmentId) query.departmentId = departmentId;
  if (designationId) query.designationId = designationId;
  if (status && activeRoleSlug !== "employee") query.status = status;
  if (employeeState === "active" && activeRoleSlug !== "employee") {
    if (status === "resigned") {
      query._id = { $in: [] };
    } else if (!status) {
      query.status = { $ne: "resigned" };
    }
    query.employmentLifecycleStatus = { $ne: "terminated" };
  }
  if (employeeState === "inactive" && activeRoleSlug !== "employee") {
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { isDeleted: true },
          { status: "resigned" },
          { employmentLifecycleStatus: "terminated" }
        ]
      }
    ];
  }
  if (managerId) query.managerId = managerId;
  if (employmentType) query.employmentType = employmentType;

  const sortField = EMPLOYEE_ALLOWED_SORT_FIELDS.has(String(sortBy))
    ? String(sortBy)
    : "employeeCode";
  const normalizedSortOrder = String(sortOrder || "asc").toLowerCase();
  const sortDirection = normalizedSortOrder === "desc" ? -1 : 1;

  return {
    query,
    includeDeleted,
    sortField,
    sortDirection,
    effectiveOrganizationId
  };
};

const buildRoleMapByUserIds = async ({ organizationId, userIds }) => {
  if (!Array.isArray(userIds) || !userIds.length) return new Map();

  const orgUsers = await OrgUser.find({
    organizationId,
    userId: { $in: userIds }
  })
    .populate("roleIds", "name slug")
    .select("userId roleIds");

  return new Map(
    orgUsers.map((orgUser) => [
      String(orgUser.userId),
      (orgUser.roleIds || []).map((role) => ({
        _id: role._id,
        name: role.name,
        slug: role.slug
      }))
    ])
  );
};

const loadPayrollExportMap = async (organizationId) => {
  const payrollMap = new Map();
  const pool = await getPayrollPgPool();
  if (!pool) return payrollMap;

  const client = await pool.connect();
  try {
    const tenantResult = await client.query(
      `SELECT id FROM payroll_tenants WHERE organization_id = $1`,
      [String(organizationId)]
    );
    const tenantId = tenantResult.rows[0]?.id;
    if (!tenantId) return payrollMap;

    const limit = 5000;
    let offset = 0;

    while (true) {
      const result = await client.query(
        `
          SELECT
            epp.employee_external_id,
            epp.payroll_status,
            epp.default_payment_mode,
            latest_salary.annual_ctc,
            latest_salary.monthly_gross,
            latest_salary.basic_pay,
            COALESCE(
              (latest_salary.metadata->'salaryRules'->>'variablePayTargetMonthly')::numeric,
              latest_salary.variable_pay,
              0
            ) AS variable_pay_target,
            CASE
              WHEN COALESCE((latest_salary.metadata->'salaryRules'->>'variablePayApprovalStatus'), 'pending') IN ('approved', 'partial')
                THEN COALESCE((latest_salary.metadata->'salaryRules'->>'variablePayApprovedAmount')::numeric, latest_salary.variable_pay, 0)
              ELSE 0
            END AS variable_pay,
            COALESCE((latest_salary.metadata->'salaryRules'->>'variablePayApprovedAmount')::numeric, latest_salary.variable_pay, 0) AS variable_pay_approved_amount,
            COALESCE((latest_salary.metadata->'salaryRules'->>'variablePayApprovalStatus'), 'pending') AS variable_pay_approval_status,
            latest_bank.account_holder_name,
            latest_bank.bank_name,
            latest_bank.branch_name,
            latest_bank.account_number,
            latest_bank.ifsc_code,
            latest_bank.account_type,
            latest_bank.payment_mode,
            latest_bank.upi_id
          FROM employee_payroll_profiles epp
          LEFT JOIN LATERAL (
            SELECT
              annual_ctc,
              monthly_gross,
              basic_pay,
              variable_pay,
              metadata
            FROM employee_salary_structures
            WHERE employee_payroll_profile_id = epp.id
            ORDER BY is_current DESC, version_no DESC, effective_from DESC
            LIMIT 1
          ) latest_salary ON true
          LEFT JOIN LATERAL (
            SELECT
              account_holder_name,
              bank_name,
              branch_name,
              account_number,
              ifsc_code,
              account_type,
              payment_mode,
              upi_id
            FROM employee_bank_details
            WHERE employee_payroll_profile_id = epp.id
            ORDER BY is_primary DESC, version_no DESC, effective_from DESC
            LIMIT 1
          ) latest_bank ON true
          WHERE epp.tenant_id = $1
          ORDER BY epp.created_at DESC
          LIMIT $2
          OFFSET $3
        `,
        [tenantId, limit, offset]
      );

      if (!result.rows.length) break;

      for (const row of result.rows) {
        const employeeId = String(row.employee_external_id || "");
        if (!employeeId || payrollMap.has(employeeId)) continue;
        payrollMap.set(employeeId, row);
      }

      if (result.rows.length < limit) break;
      offset += limit;
    }

    return payrollMap;
  } finally {
    client.release();
  }
};

exports.listByOrganization = async (req) => {
  const { page, limit, scope, compact } = req.query;
  const isCompactMode = String(compact || "false").toLowerCase() === "true";
  const isOrganizationTreeScope = scope === "organizationTree";
  const { query, includeDeleted, sortField, sortDirection, effectiveOrganizationId } =
    await buildEmployeeListContext(req);

  // Build query
  let employeeQuery = Employee.find(query).setOptions({ includeDeleted });
  if (isCompactMode) {
    employeeQuery = employeeQuery
      .select("_id firstName lastName employeeCode dateOfJoining status employmentLifecycleStatus departmentId designationId shiftId")
      .populate("departmentId", "name")
      .populate("designationId", "name")
      .populate("shiftId", "startTime");
  } else {
    employeeQuery = employeeQuery
      .populate("departmentId", "name")
      .populate("designationId", "name")
      .populate("managerId", "firstName lastName")
      .populate("leaveApprovalFlowId", "name moduleKey")
      .populate("attendanceApprovalFlowId", "name moduleKey")
      .populate("shiftId", "name code startTime endTime graceMinutes status")
      .populate("userId", "email")
      .sort({ [sortField]: sortDirection, createdAt: -1 });
  }

  let pagination = null;
  let total = null;

  // Apply pagination only for normal list views. The org tree needs the full
  // scoped employee set so managers can be attached to their reports.
  if (!isOrganizationTreeScope && page && limit) {
    total = await Employee.countDocuments(query);
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    employeeQuery = employeeQuery.skip(skip).limit(limitNum);

    pagination = {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    };
  }

  const employees = await employeeQuery;
  let items = [];
  if (isCompactMode) {
    items = employees.map((employee) => {
      const obj = employee.toObject();
      return {
        ...obj,
        firstName: toNameCase(obj.firstName),
        lastName: toNameCase(obj.lastName)
      };
    });
  } else {
    const userIds = employees
      .map((employee) => employee.userId?._id || employee.userId)
      .filter(Boolean);
    const roleMap = await buildRoleMapByUserIds({
      organizationId: effectiveOrganizationId,
      userIds
    });
    items = employees.map((employee) => {
      const obj = employee.toObject();
      return {
        ...obj,
        firstName: toNameCase(obj.firstName),
        lastName: toNameCase(obj.lastName),
        roleIds: roleMap.get(String(employee.userId?._id || employee.userId)) || []
      };
    });
  }

  return {
    items,
    pagination // will be null if not paginated
  };
};

exports.exportCsv = async (req, res) => {
  const { query, includeDeleted, sortField, sortDirection, effectiveOrganizationId } =
    await buildEmployeeListContext(req);
  const payrollMap = await loadPayrollExportMap(effectiveOrganizationId);

  const cursor = Employee.find(query)
    .setOptions({ includeDeleted })
    .populate("departmentId", "name")
    .populate("designationId", "name")
    .populate("managerId", "firstName lastName")
    .populate("leaveApprovalFlowId", "name moduleKey")
    .populate("attendanceApprovalFlowId", "name moduleKey")
    .populate("shiftId", "name")
    .populate("userId", "email")
    .sort({ [sortField]: sortDirection, createdAt: -1 })
    .lean()
    .cursor();

  const orgUsers = await OrgUser.find({ organizationId: effectiveOrganizationId })
    .populate("roleIds", "name")
    .select("userId roleIds")
    .lean();
  const roleNameByUserId = new Map(
    orgUsers.map((row) => [
      String(row.userId),
      (row.roleIds || [])
        .map((role) => role?.name)
        .filter(Boolean)
        .join(", ")
    ])
  );

  const fileStamp = new Date().toISOString().slice(0, 10);
  const fileName = `employees-${fileStamp}.csv`;

  res.status(200);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Cache-Control", "no-store");

  const headers = [
    "Employee Code",
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "Department",
    "Designation",
    "Roles",
    "Manager",
    "Shift",
    "Employment Type",
    "Status",
    "Lifecycle",
    "Benefits Eligible",
    "Profile Completed",
    "Date Of Joining",
    "Payroll Status",
    "Default Payment Mode",
    "Annual CTC",
    "Monthly Gross",
    "Basic Pay",
    "Variable Pay",
    "Bank Account Holder",
    "Bank Name",
    "Branch Name",
    "Account Number",
    "IFSC Code",
    "Account Type",
    "Bank Payment Mode",
    "UPI ID"
  ];

  const writeRow = async (cells) => {
    const line = `${cells.map(toCsvValue).join(",")}\n`;
    if (!res.write(line)) {
      await once(res, "drain");
    }
  };

  await writeRow(headers);

  for await (const employee of cursor) {
    if (res.writableEnded || res.destroyed) break;

    const employeeId = String(employee?._id || "");
    const userId = String(employee?.userId?._id || employee?.userId || "");
    const managerName = [employee?.managerId?.firstName, employee?.managerId?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const payroll = payrollMap.get(employeeId) || {};

    await writeRow([
      employee?.employeeCode || "",
      toNameCase(employee?.firstName || ""),
      toNameCase(employee?.lastName || ""),
      employee?.userId?.email || "",
      employee?.phone || "",
      employee?.departmentId?.name || "",
      employee?.designationId?.name || "",
      roleNameByUserId.get(userId) || "",
      managerName,
      employee?.shiftId?.name || "",
      employee?.employmentType || "",
      employee?.status || "",
      employee?.employmentLifecycleStatus || "",
      employee?.benefitsEligible ? "Yes" : "No",
      employee?.profileCompleted ? "Yes" : "No",
      toDateValue(employee?.dateOfJoining),
      payroll?.payroll_status || "",
      payroll?.default_payment_mode || "",
      payroll?.annual_ctc ?? "",
      payroll?.monthly_gross ?? "",
      payroll?.basic_pay ?? "",
      payroll?.variable_pay ?? "",
      payroll?.account_holder_name || "",
      payroll?.bank_name || "",
      payroll?.branch_name || "",
      payroll?.account_number || "",
      payroll?.ifsc_code || "",
      payroll?.account_type || "",
      payroll?.payment_mode || "",
      payroll?.upi_id || ""
    ]);
  }

  res.end();
};

exports.getNextEmployeeCode = async (req) => {
  const { organizationId } = req.user;
  const employeeCode = await generateEmployeeCode(organizationId);
  return { employeeCode };
};

exports.getById = async (req) => {
  const { id } = req.params;
  const { organizationId, userId, roleIds, activeRoleId } = req.user;

  const employee = await Employee.findOne({
    _id: id,
    organizationId
  })
    .setOptions({ includeDeleted: true })
    .populate("departmentId", "name")
    .populate("designationId", "name")
    .populate("managerId", "firstName lastName")
    .populate("leaveApprovalFlowId", "name moduleKey")
    .populate("attendanceApprovalFlowId", "name moduleKey")
    .populate("shiftId", "name code startTime endTime graceMinutes status")
    .populate("userId", "email");

  if (!employee) {
    throw { code: 404, message: "Employee not found" };
  }

  /**
   * 🔒 Manager scoping:
   * Manager can only view employees who report to them
   */
  if (roleIds?.length && employee.managerId && activeRoleId) {
    const role = await Role.findOne({
      _id: activeRoleId,
      organizationId
    }).select("slug");

    if (role?.slug === "manager") {
      const managerEmployee = await Employee.findOne({
        userId,
        organizationId
      }).select("_id");

      if (
        managerEmployee &&
        employee.managerId._id.toString() !== managerEmployee._id.toString()
      ) {
        throw { code: 403, message: "Access denied" };
      }
    }
  }

  const orgUser = await OrgUser.findOne({
    userId: employee.userId?._id || employee.userId,
    organizationId
  }).populate("roleIds", "name");

  return {
    ...employee.toObject(),
    firstName: toNameCase(employee.firstName),
    lastName: toNameCase(employee.lastName),
    roleIds: orgUser?.roleIds || []
  };
};

exports.getMe = async (req) => {
  const ensuredEmployee = await ensureEmployeeRecordForOrgUser({
    organizationId: req.user.organizationId,
    userId: req.user.userId
  });

  const employee = await Employee.findOne({
    _id: ensuredEmployee?._id,
    organizationId: req.user.organizationId,
    isDeleted: false
  })
    .populate("userId", "email")
    .populate("departmentId", "name")
    .populate("designationId", "name")
    .populate("managerId", "firstName lastName")
    .populate("leaveApprovalFlowId", "name moduleKey")
    .populate("attendanceApprovalFlowId", "name moduleKey")
    .populate("shiftId", "name code startTime endTime graceMinutes status");

  if (!employee) {
    const user = await User.findById(req.user.userId).select("email");
    return {
      userId: { email: user?.email || "" },
      firstName: "",
      lastName: "",
      departmentId: null,
      designationId: null,
      employmentType: "",
      dateOfJoining: null,
      managerId: null,
      leaveApprovalFlowId: null,
      attendanceApprovalFlowId: null,
      shiftId: null,
      profileCompleted: false,
      profileImage: null,
      addressProof: null
    };
  }

  return employee;
};

/* ------------------------------------------------------------------ */
/* HR / ADMIN UPDATES EMPLOYEE                                         */
/* ------------------------------------------------------------------ */
exports.updateByHr = async (req) => {
  const { id } = req.params;
  const { organizationId } = req.user;
  const statusChangeRequested = req.body.status === "active" || req.body.status === "resigned";

  if (statusChangeRequested) {
    await ensureCanChangeEmployeeActiveState(req);
  }

  const employee = await Employee.findOne({
    _id: id,
    organizationId,
    ...(statusChangeRequested ? {} : { isDeleted: false })
  }).setOptions({ includeDeleted: statusChangeRequested });

  if (!employee) {
    throw { code: 404, message: "Employee not found" };
  }

  const {
    email,
    roleIds,
    firstName,
    lastName,
    phone,
    employeeCode,
    departmentId,
    designationId,
    dateOfJoining,
    employmentType,
    status,
    employmentLifecycleStatus,
    lastWorkingDay,
    confirmedDate,
    managerId,
    leaveApprovalFlowId,
    attendanceApprovalFlowId,
    shiftId,
    dob,
    gender,
    aadhaarNumber,
    panNumber,
    address,
    emergencyContacts,
    profileImageUpload,
    addressProofUpload,
    aadhaarProofUpload,
    panProofUpload
  } = req.body;
  const normalizedEmployeeCode = normalizeEmployeeCode(employeeCode);

  if (normalizedEmployeeCode && normalizedEmployeeCode !== employee.employeeCode) {
    const exists = await Employee.findOne({
      organizationId,
      employeeCode: normalizedEmployeeCode,
      _id: { $ne: employee._id }
    });
    if (exists) {
      throw { code: 409, message: "Employee code already exists" };
    }
  }

  if (email) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findById(employee.userId);
    if (!user) {
      throw { code: 404, message: "User not found" };
    }

    if (normalizedEmail !== user.email) {
      const emailExists = await User.findOne({
        email: normalizedEmail,
        _id: { $ne: user._id }
      });
      if (emailExists) {
        throw { code: 409, message: "Email already exists" };
      }
      user.email = normalizedEmail;
      await user.save();
    }
  }

  if (dateOfJoining !== undefined && employee.employmentLifecycleStatus === "probation") {
    const probationDays = normalizeNonNegativeNumber(
      employee.probationPeriodDays,
      DEFAULT_PROBATION_DAYS
    );
    employee.probationStartDate = new Date(dateOfJoining);
    employee.probationEndDate = addDays(dateOfJoining, probationDays);
  }

  const resolvedLeaveApprovalFlowId = leaveApprovalFlowId !== undefined
    ? await resolveAssignedApprovalFlowId({
        organizationId,
        moduleKey: "leave",
        flowId: leaveApprovalFlowId
      })
    : undefined;
  const resolvedAttendanceApprovalFlowId = attendanceApprovalFlowId !== undefined
    ? await resolveAssignedApprovalFlowId({
        organizationId,
        moduleKey: "attendance_request",
        flowId: attendanceApprovalFlowId
      })
    : undefined;

  const updates = {
    firstName: firstName !== undefined ? toNameCase(firstName) : undefined,
    lastName: lastName !== undefined ? toNameCase(lastName) : undefined,
    phone,
    employeeCode: normalizedEmployeeCode || undefined,
    departmentId,
    designationId,
    dateOfJoining,
    employmentType,
    status,
    managerId,
    leaveApprovalFlowId: resolvedLeaveApprovalFlowId,
    attendanceApprovalFlowId: resolvedAttendanceApprovalFlowId,
    shiftId,
    dob,
    gender,
    aadhaarNumber,
    panNumber: panNumber ? String(panNumber).trim().toUpperCase() : panNumber,
    address,
    emergencyContacts
  };

  Object.keys(updates).forEach((key) => {
    if (updates[key] !== undefined) {
      employee[key] = updates[key];
    }
  });

  if (employmentLifecycleStatus !== undefined) {
    applyLifecycleChange(employee, employmentLifecycleStatus, { lastWorkingDay, confirmedDate });
  } else {
    if (lastWorkingDay !== undefined) {
      const normalizedLastWorkingDay = normalizeDateOnly(lastWorkingDay);
      employee.lastWorkingDay = normalizedLastWorkingDay;
      if (employee.employmentLifecycleStatus === "notice") {
        employee.noticeEndDate = normalizedLastWorkingDay;
      }
    }
    if (confirmedDate !== undefined) {
      const normalizedConfirmedDate = normalizeDateOnly(confirmedDate);
      employee.confirmedDate = normalizedConfirmedDate;
      employee.probationCompletedAt = normalizedConfirmedDate;
    }
  }

  if (status === "resigned") {
    applyLifecycleChange(employee, "notice");
  }
  if (status === "active") {
    employee.isDeleted = false;
    employee.deletedAt = undefined;
    employee.deletedBy = undefined;
    if (employee.employmentLifecycleStatus === "terminated" || employee.employmentLifecycleStatus === "notice") {
      applyLifecycleChange(employee, "confirmed");
    }
    const user = await User.findById(employee.userId).select("status organizationIds activeOrganizationId softDeleteMeta email");
    if (user) {
      const originalEmail = user.softDeleteMeta?.originalEmail;
      if (originalEmail && user.email !== originalEmail) {
        const emailOwner = await User.findOne({
          email: originalEmail,
          _id: { $ne: user._id }
        }).select("_id");
        if (!emailOwner) user.email = originalEmail;
      }
      user.status = "active";
      if (!user.organizationIds?.some((orgId) => String(orgId) === String(organizationId))) {
        user.organizationIds = [...(user.organizationIds || []), organizationId];
      }
      user.activeOrganizationId = user.activeOrganizationId || organizationId;
      await user.save();
    }
  }

  if (employee.employmentLifecycleStatus === "terminated") {
    employee.status = "resigned";
  }

  if (profileImageUpload?.base64Data && profileImageUpload?.mimeType) {
    const imageDataUri = `data:${profileImageUpload.mimeType};base64,${profileImageUpload.base64Data}`;
    const uploadedImage = await uploadDataUri(imageDataUri, {
      folder: "hrms/employee-profile-images"
    });
    employee.profileImage = uploadedImage?.secure_url || null;
  }

  if (addressProofUpload?.base64Data && addressProofUpload?.mimeType) {
    const proofDataUri = `data:${addressProofUpload.mimeType};base64,${addressProofUpload.base64Data}`;
    const uploadedProof = await uploadDataUri(proofDataUri, {
      folder: "hrms/employee-address-proofs"
    });
    employee.addressProof = {
      fileName: addressProofUpload.fileName || "address-proof",
      fileUrl: uploadedProof?.secure_url || "",
      mimeType: addressProofUpload.mimeType || "",
      uploadedAt: new Date()
    };
  }

  if (aadhaarProofUpload?.base64Data && aadhaarProofUpload?.mimeType) {
    const aadhaarDataUri = `data:${aadhaarProofUpload.mimeType};base64,${aadhaarProofUpload.base64Data}`;
    const uploadedAadhaar = await uploadDataUri(aadhaarDataUri, {
      folder: "hrms/employee-aadhaar-proofs"
    });
    employee.aadhaarProof = {
      fileName: aadhaarProofUpload.fileName || "aadhaar-proof",
      fileUrl: uploadedAadhaar?.secure_url || "",
      mimeType: aadhaarProofUpload.mimeType || "",
      uploadedAt: new Date()
    };
  }

  if (panProofUpload?.base64Data && panProofUpload?.mimeType) {
    const panDataUri = `data:${panProofUpload.mimeType};base64,${panProofUpload.base64Data}`;
    const uploadedPan = await uploadDataUri(panDataUri, {
      folder: "hrms/employee-pan-proofs"
    });
    employee.panProof = {
      fileName: panProofUpload.fileName || "pan-proof",
      fileUrl: uploadedPan?.secure_url || "",
      mimeType: panProofUpload.mimeType || "",
      uploadedAt: new Date()
    };
  }

  await employee.save();

  if (employee.status === "resigned" || employee.employmentLifecycleStatus === "terminated") {
    await syncEmployeePayrollStatus({
      organizationId,
      employeeId: employee._id,
      payrollStatus: "exited"
    });
  } else if (employee.status === "active") {
    await syncEmployeePayrollStatus({
      organizationId,
      employeeId: employee._id,
      payrollStatus: "active"
    });
  }

  if (roleIds?.length) {
    await OrgUser.findOneAndUpdate(
      { userId: employee.userId, organizationId },
      { roleIds },
      { new: true }
    );
  }

  return buildEmployeeResponse({
    employeeId: employee._id,
    organizationId
  });
};

exports.lifecycleAction = async (req) => {
  const { id } = req.params;
  const { organizationId, userId } = req.user;
  const { action, reason, lastWorkingDay, confirmedDate } = req.body;

  const employee = await Employee.findOne({
    _id: id,
    organizationId,
    isDeleted: false
  });

  if (!employee) {
    throw { code: 404, message: "Employee not found" };
  }

  const actorRoleSlug = await getActorRoleSlug(req);
  if (!LIFECYCLE_ACTION_ROLE_SLUGS.has(actorRoleSlug)) {
    throw { code: 403, message: "Only team lead, manager, HR, or admin can update employee lifecycle" };
  }

  if (actorRoleSlug === "manager") {
    const managerEmployee = await Employee.findOne({
      userId,
      organizationId,
      isDeleted: false
    }).select("_id");

    if (!managerEmployee) {
      throw { code: 403, message: "Access denied" };
    }

    if (String(employee.managerId || "") !== String(managerEmployee._id)) {
      throw { code: 403, message: "Managers can only action direct reports" };
    }
  }

  if (action === "confirm") {
    applyLifecycleChange(employee, "confirmed", { confirmedDate });
    employee.status = "active";
  } else if (action === "terminate_with_notice") {
    applyLifecycleChange(employee, "notice", { lastWorkingDay });
    employee.status = "resigned";
  } else {
    applyLifecycleChange(employee, "terminated", { lastWorkingDay });
    employee.status = "resigned";
  }

  await employee.save();

  await syncEmployeePayrollStatus({
    organizationId,
    employeeId: employee._id,
    payrollStatus:
      employee.status === "resigned" || employee.employmentLifecycleStatus === "terminated"
        ? "exited"
        : "active"
  });

  const actorEmployee = await Employee.findOne({
    userId,
    organizationId,
    isDeleted: false
  }).select("firstName lastName");
  const actorName = actorEmployee
    ? `${actorEmployee.firstName || ""} ${actorEmployee.lastName || ""}`.trim() || "Management"
    : "Management";

  await createNotificationSafe({
    organizationId,
    recipientUserId: employee.userId,
    recipientEmployeeId: employee._id,
    actorEmployeeId: actorEmployee?._id || null,
    type: "employee_lifecycle",
    title: "Employment lifecycle updated",
    message: `${actorName} marked your employment status as ${employee.employmentLifecycleStatus}.`,
    meta: {
      action,
      reason: reason || "",
      employmentLifecycleStatus: employee.employmentLifecycleStatus
    }
  });

  return buildEmployeeResponse({
    employeeId: employee._id,
    organizationId
  });
};

exports.reopenProfileCompletion = async (req) => {
  const { id } = req.params;
  const { organizationId } = req.user;

  const employee = await Employee.findOne({
    _id: id,
    organizationId,
    isDeleted: false
  });

  if (!employee) {
    throw { code: 404, message: "Employee not found" };
  }

  employee.profileCompleted = false;
  await employee.save();

  return buildEmployeeResponse({
    employeeId: employee._id,
    organizationId
  });
};

exports.bulkUpdate = async (req) => {
  const { organizationId } = req.user;
  const {
    employeeIds = [],
    shiftId,
    managerId,
    departmentId,
    designationId,
    status,
    employmentLifecycleStatus
  } = req.body;

  if (status === "active" || status === "resigned") {
    await ensureCanChangeEmployeeActiveState(req);
  }

  const employees = await Employee.find({
    organizationId,
    _id: { $in: employeeIds },
    ...(status === "active" ? {} : { isDeleted: false })
  }).setOptions({ includeDeleted: status === "active" });

  if (!employees.length) {
    throw { code: 404, message: "No employees found for bulk update" };
  }

  for (const employee of employees) {
    if (shiftId !== undefined) {
      employee.shiftId = shiftId || null;
    }
    if (managerId !== undefined) {
      employee.managerId = managerId || null;
    }
    if (departmentId !== undefined) {
      employee.departmentId = departmentId;
    }
    if (designationId !== undefined) {
      employee.designationId = designationId;
    }
    if (status !== undefined) {
      employee.status = status;
      if (status === "resigned") {
        applyLifecycleChange(employee, "notice");
      } else if (status === "active") {
        employee.isDeleted = false;
        employee.deletedAt = undefined;
        employee.deletedBy = undefined;
        if (employee.employmentLifecycleStatus === "terminated" || employee.employmentLifecycleStatus === "notice") {
          applyLifecycleChange(employee, "confirmed");
        }
        const user = await User.findById(employee.userId).select("status organizationIds activeOrganizationId");
        if (user) {
          user.status = "active";
          if (!user.organizationIds?.some((orgId) => String(orgId) === String(organizationId))) {
            user.organizationIds = [...(user.organizationIds || []), organizationId];
          }
          user.activeOrganizationId = user.activeOrganizationId || organizationId;
          await user.save();
        }
      }
    }
    if (employmentLifecycleStatus !== undefined) {
      applyLifecycleChange(employee, employmentLifecycleStatus);
      if (employmentLifecycleStatus === "terminated") {
        employee.status = "resigned";
      } else if (employmentLifecycleStatus === "confirmed") {
        employee.status = "active";
      }
    }
  }

  await Promise.all(employees.map((employee) => employee.save()));
  await Promise.all(
    employees.map((employee) =>
      syncEmployeePayrollStatus({
        organizationId,
        employeeId: employee._id,
        payrollStatus:
          employee.status === "resigned" || employee.employmentLifecycleStatus === "terminated"
            ? "exited"
            : "active"
      })
    )
  );

  return {
    updatedCount: employees.length,
    employeeIds: employees.map((employee) => employee._id)
  };
};

/* ------------------------------------------------------------------ */
/* HR / ADMIN SOFT DELETE EMPLOYEE                                     */
/* ------------------------------------------------------------------ */
exports.remove = async (req) => {
  throw {
    code: 405,
    message: "Employee deletion is disabled. Mark the employee inactive instead."
  };
};

const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const getNextOccurrence = (baseDate, fromDate) => {
  const month = baseDate.getMonth();
  const day = baseDate.getDate();
  let year = fromDate.getFullYear();

  // Handle Feb 29 birthdays/anniversaries in non-leap years as Feb 28
  let targetDay = day;
  if (month === 1 && day === 29 && !isLeapYear(year)) {
    targetDay = 28;
  }

  let next = new Date(year, month, targetDay);
  if (next < fromDate) {
    year += 1;
    targetDay = day;
    if (month === 1 && day === 29 && !isLeapYear(year)) {
      targetDay = 28;
    }
    next = new Date(year, month, targetDay);
  }

  return next;
};

exports.getUpcomingEvents = async (req) => {
  const days = Math.min(31, Math.max(1, Number(req.query.days || 7)));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + days);

  const query = {
    organizationId: req.user.organizationId,
    isDeleted: false,
    status: { $ne: "resigned" }
  };

  if (req.user.activeRoleId) {
    const role = await Role.findOne({
      _id: req.user.activeRoleId,
      organizationId: req.user.organizationId
    }).select("slug");

    if (role?.slug === "manager") {
      const managerEmployee = await Employee.findOne({
        userId: req.user.userId,
        organizationId: req.user.organizationId
      }).select("_id");

      if (managerEmployee) {
        query.managerId = managerEmployee._id;
      }
    }
  }

  const employees = await Employee.find(query)
    .select("firstName lastName employeeCode dob dateOfJoining");

  const birthdays = [];
  const anniversaries = [];

  for (const e of employees) {
    const name = `${e.firstName || ""} ${e.lastName || ""}`.trim();

    if (e.dob) {
      const dob = new Date(e.dob);
      const nextBirthday = getNextOccurrence(dob, today);
      if (nextBirthday >= today && nextBirthday <= end) {
        const diffDays = Math.floor((nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        birthdays.push({
          employeeId: e._id,
          employeeCode: e.employeeCode,
          firstName: e.firstName,
          lastName: e.lastName,
          name,
          eventDate: nextBirthday,
          daysAway: diffDays
        });
      }
    }

    if (e.dateOfJoining) {
      const doj = new Date(e.dateOfJoining);
      const nextAnniversary = getNextOccurrence(doj, today);
      if (nextAnniversary >= today && nextAnniversary <= end) {
        const diffDays = Math.floor((nextAnniversary.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const years = nextAnniversary.getFullYear() - doj.getFullYear();
        anniversaries.push({
          employeeId: e._id,
          employeeCode: e.employeeCode,
          firstName: e.firstName,
          lastName: e.lastName,
          name,
          eventDate: nextAnniversary,
          daysAway: diffDays,
          years
        });
      }
    }
  }

  birthdays.sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
  anniversaries.sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());

  return {
    windowDays: days,
    birthdays,
    anniversaries
  };
};
