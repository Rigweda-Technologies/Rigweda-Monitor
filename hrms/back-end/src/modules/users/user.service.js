const User = require("./user.model");
const OrgUser = require("../organizations/org-user.model");
const { genHashedPassword, checkPasswords } = require("../../utils/bcryptUtils");
const { createJwtToken } = require("../../utils/jwtToken");
const { rotateUserToken } = require("../../utils/tokenManager");
const Role = require("../roles/role.model");
const Permission = require("../permissions/permission.model");
const sendMail = require("../../utils/sendMail");
const Employee = require("../employees/employee.model");
const OrgSettings = require("../orgSettings/orgSettings.model");
const leaveBalanceService = require("../leaveBalances/leaveBalance.service");
const { getDefaultMaxActiveLoginsPerUser } = require("../../utils/orgSettingsDefaults");

const FACEPP_COMPARE_URL = process.env.FACEPP_COMPARE_URL || "https://api-us.faceplusplus.com/facepp/v3/compare";
const FACEPP_DETECT_URL = process.env.FACEPP_DETECT_URL || "https://api-us.faceplusplus.com/facepp/v3/detect";
const FACE_MATCH_MIN_CONFIDENCE = Number(process.env.FACE_MATCH_MIN_CONFIDENCE || 70);
const FACE_LOGIN_ALLOW_PASSWORD_FALLBACK = String(process.env.FACE_LOGIN_ALLOW_PASSWORD_FALLBACK || "false").toLowerCase() === "true";
const INVALID_CREDENTIALS_ERROR = {
  code: 400,
  message: "Invalid credentials"
};
const FALLBACK_EMPLOYEE_ROLE_SLUG = "employee";

const getMaxActiveLoginsPerUser = async (organizationId) => {
  const settings = await OrgSettings.findOne({ organizationId }).select("maxActiveLoginsPerUser").lean();
  const configuredLimit = Number(settings?.maxActiveLoginsPerUser);
  if (Number.isInteger(configuredLimit) && configuredLimit > 0) {
    return configuredLimit;
  }
  return getDefaultMaxActiveLoginsPerUser();
};

const SUPERADMIN_ROLE_SLUGS = new Set(["superadmin", "super_admin"]);

const isSuperAdminSwitchContext = async ({ user, dbUser, targetOrganizationId }) => {
  if (!user?.userId || !targetOrganizationId) return false;

  const currentOrgId = user.organizationId ? String(user.organizationId) : "";
  const isSystemOrgSwitch =
    currentOrgId &&
    currentOrgId !== String(targetOrganizationId) &&
    process.env.SYSTEM_ORG_ID &&
    currentOrgId === String(process.env.SYSTEM_ORG_ID);

  if (isSystemOrgSwitch) return true;

  const memberships = await OrgUser.find({ userId: dbUser._id })
    .populate("roleIds", "slug isSystemRole")
    .lean();

  return memberships.some((membership) =>
    (membership.roleIds || []).some((role) =>
      SUPERADMIN_ROLE_SLUGS.has(String(role?.slug || ""))
    )
  );
};

const extractBase64Payload = (value = "") => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:")) {
    const commaIndex = trimmed.indexOf(",");
    return commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : "";
  }
  return trimmed;
};

const compareFacesWithFacePP = async ({ profileImageUrl, selfieImage }) => {
  const apiKey = process.env.FACEPP_API_KEY;
  const apiSecret = process.env.FACEPP_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw {
      code: 503,
      message: "Selfie login provider is not configured. Set FACEPP_API_KEY and FACEPP_API_SECRET."
    };
  }

  const selfieBase64 = extractBase64Payload(selfieImage);
  if (!selfieBase64) {
    throw {
      code: 400,
      message: "Invalid selfie image payload"
    };
  }

  const body = new URLSearchParams();
  body.set("api_key", apiKey);
  body.set("api_secret", apiSecret);
  body.set("image_url1", profileImageUrl);
  body.set("image_base64_2", selfieBase64);

  let responseJson;
  try {
    const response = await fetch(FACEPP_COMPARE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    responseJson = await response.json();
  } catch {
    throw {
      code: 502,
      message: "Face verification service is unreachable"
    };
  }

  if (responseJson?.error_message) {
    throw {
      code: 400,
      message: `Face verification failed: ${responseJson.error_message}`
    };
  }

  const confidence = Number(responseJson?.confidence || 0);
  const passed = confidence >= FACE_MATCH_MIN_CONFIDENCE;
  return { passed, confidence };
};

const detectEyesWithFacePP = async ({ selfieImage }) => {
  const apiKey = process.env.FACEPP_API_KEY;
  const apiSecret = process.env.FACEPP_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw {
      code: 503,
      message: "Selfie login provider is not configured. Set FACEPP_API_KEY and FACEPP_API_SECRET."
    };
  }

  const selfieBase64 = extractBase64Payload(selfieImage);
  if (!selfieBase64) {
    throw {
      code: 400,
      message: "Invalid selfie image payload"
    };
  }

  const body = new URLSearchParams();
  body.set("api_key", apiKey);
  body.set("api_secret", apiSecret);
  body.set("image_base64", selfieBase64);
  body.set("return_attributes", "eyestatus");

  let responseJson;
  try {
    const response = await fetch(FACEPP_DETECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    responseJson = await response.json();
  } catch {
    throw {
      code: 502,
      message: "Face liveness service is unreachable"
    };
  }

  if (responseJson?.error_message) {
    throw {
      code: 400,
      message: `Face liveness failed: ${responseJson.error_message}`
    };
  }

  const face = responseJson?.faces?.[0];
  if (!face?.attributes?.eyestatus) {
    throw {
      code: 400,
      message: "No clear face detected for liveness check"
    };
  }

  const left = face.attributes.eyestatus.left_eye_status || {};
  const right = face.attributes.eyestatus.right_eye_status || {};
  const pickMax = (obj = {}, keys = []) => Math.max(...keys.map((k) => Number(obj[k] || 0)));
  const openKeys = ["no_glass_eye_open", "normal_glass_eye_open", "dark_glasses"];
  const closeKeys = ["no_glass_eye_close", "normal_glass_eye_close"];
  const openScore = Math.min(
    pickMax(left, openKeys),
    pickMax(right, openKeys)
  );
  const closeScore = Math.min(
    pickMax(left, closeKeys),
    pickMax(right, closeKeys)
  );

  return { openScore, closeScore };
};

const resolveLoginContext = async ({ email, password }) => {
  if (!email || !password) {
    throw {
      code: 400,
      message: "Email and password are required"
    };
  }

  const normalizedEmail = email.toLowerCase().trim();

  const user = await User.findOne({ email: normalizedEmail }).select("+password");
  if (!user) {
    throw INVALID_CREDENTIALS_ERROR;
  }

  const valid = await checkPasswords(password, user.password);
  if (!valid) {
    throw INVALID_CREDENTIALS_ERROR;
  }

  const memberships = await OrgUser
    .find({ userId: user._id })
    .populate("organizationId")
    .populate("roleIds");

  if (!memberships || memberships.length === 0) {
    throw {
      code: 403,
      message: "No organization access"
    };
  }

  const m = memberships[0];
  const employee = await Employee.findOne({
    userId: user._id,
    organizationId: m.organizationId?._id || m.organizationId,
    isDeleted: false
  }).select("employmentLifecycleStatus noticeEndDate");

  if (employee?.employmentLifecycleStatus === "terminated") {
    throw {
      code: 403,
      message: "Your employment has been terminated. Please contact your manager."
    };
  }

  if (employee?.employmentLifecycleStatus === "notice") {
    const now = new Date();
    const noticeEndDate = employee.noticeEndDate ? new Date(employee.noticeEndDate) : null;

    if (noticeEndDate) {
      noticeEndDate.setHours(23, 59, 59, 999);
    }

    if (noticeEndDate && now > noticeEndDate) {
      throw {
        code: 403,
        message: "Your notice period is completed. Please contact your manager."
      };
    }
  }

  const activeRole =
    m.roleIds.find((role) => role?._id?.toString() === user.lastActiveRoleId?.toString()) ||
    m.roleIds[0] ||
    null;

  if (activeRole) {
    return {
      user,
      membership: m,
      activeRole
    };
  }

  const fallbackRole = await Role.findOne({
    organizationId: m.organizationId?._id || m.organizationId,
    slug: FALLBACK_EMPLOYEE_ROLE_SLUG
  }).select("_id name slug");

  if (fallbackRole) {
    const hasFallbackRole = (m.roleIds || []).some((role) => String(role?._id || role) === String(fallbackRole._id));
    if (!hasFallbackRole) {
      await OrgUser.updateOne(
        { _id: m._id },
        { $addToSet: { roleIds: fallbackRole._id } }
      );
      m.roleIds = [...(m.roleIds || []), fallbackRole];
    }

    return {
      user,
      membership: m,
      activeRole: fallbackRole
    };
  }

  return {
    user,
    membership: m,
    activeRole
  };
};

exports.loginUser = async ({ email, password }) => {
  console.log("Attempting login with email:", email, password);
  const { user, membership, activeRole } = await resolveLoginContext({ email, password });
  const organizationId = membership.organizationId._id;
  const maxActiveLoginsPerUser = await getMaxActiveLoginsPerUser(organizationId);

  const token = createJwtToken({
    userId: user._id,
    organizationId,
    roleIds: membership.roleIds.map(r => r._id),
    activeRoleId: activeRole?._id
  });

  await rotateUserToken(User, user._id, token, {
    organizationId,
    maxActiveLoginsPerUser
  });
  await User.findByIdAndUpdate(user._id, {
    activeOrganizationId: organizationId,
    lastActiveRoleId: activeRole?._id || null,
    lastLoginAt: new Date()
  });

  return {
    token,
    userId: user._id,
    organization: membership.organizationId,
    roles: membership.roleIds,
    activeRole,
    mustChangePassword: Boolean(user.passwordChangeRequired)
  };
};

exports.loginUserWithSelfie = async ({ email, password, selfieImage, livenessSelfieImage }) => {
  if (!selfieImage || typeof selfieImage !== "string" || selfieImage.trim().length < 32) {
    throw {
      code: 400,
      message: "Valid selfie image is required"
    };
  }
  if (!livenessSelfieImage || typeof livenessSelfieImage !== "string" || livenessSelfieImage.trim().length < 32) {
    throw {
      code: 400,
      message: "Liveness selfie image is required"
    };
  }

  const { user, membership, activeRole } = await resolveLoginContext({ email, password });
  const organizationId = membership.organizationId._id;
  const maxActiveLoginsPerUser = await getMaxActiveLoginsPerUser(organizationId);
  const employee = await Employee.findOne({
    userId: user._id,
    organizationId: membership.organizationId?._id || membership.organizationId,
    isDeleted: false
  }).select("profileImage");

  if (!employee?.profileImage) {
    throw {
      code: 400,
      message: "Profile photo is not available. Contact admin before using selfie login."
    };
  }

  let faceResult = null;
  let selfieVerificationBypassed = false;
  let selfieVerificationBypassReason = null;

  try {
    const openEyes = await detectEyesWithFacePP({ selfieImage });
    if (openEyes.openScore < 50 || openEyes.openScore <= openEyes.closeScore) {
      throw {
        code: 401,
        message: "Liveness check failed: first selfie must have eyes open"
      };
    }
    const closedEyes = await detectEyesWithFacePP({ selfieImage: livenessSelfieImage });
    if (closedEyes.closeScore < 50 || closedEyes.closeScore <= closedEyes.openScore) {
      throw {
        code: 401,
        message: "Liveness check failed: second selfie must have eyes closed"
      };
    }

    faceResult = await compareFacesWithFacePP({
      profileImageUrl: employee.profileImage,
      selfieImage
    });
  } catch (err) {
    const shouldFallback = FACE_LOGIN_ALLOW_PASSWORD_FALLBACK && [502, 503].includes(err?.code);
    if (!shouldFallback) throw err;
    selfieVerificationBypassed = true;
    selfieVerificationBypassReason = err?.message || "Face verification unavailable";
  }

  if (!selfieVerificationBypassed && faceResult && !faceResult.passed) {
    throw {
      code: 401,
      message: `Face match failed (confidence ${faceResult.confidence.toFixed(2)}). Please try again.`
    };
  }

  const token = createJwtToken({
    userId: user._id,
    organizationId,
    roleIds: membership.roleIds.map(r => r._id),
    activeRoleId: activeRole?._id
  });

  await rotateUserToken(User, user._id, token, {
    organizationId,
    maxActiveLoginsPerUser
  });
  await User.findByIdAndUpdate(user._id, {
    activeOrganizationId: organizationId,
    lastActiveRoleId: activeRole?._id || null,
    lastLoginAt: new Date()
  });

  return {
    token,
    userId: user._id,
    organization: membership.organizationId,
    roles: membership.roleIds,
    activeRole,
    mustChangePassword: Boolean(user.passwordChangeRequired),
    selfieVerificationBypassed,
    selfieVerificationBypassReason,
    faceMatchConfidence: faceResult?.confidence ?? null
  };
};

exports.createOrgUser = async ({
  email,
  password,
  roleIds,
  firstName,
  lastName,
  departmentId,
  designationId,
  employmentType,
  dateOfJoining,
  managerId,
  shiftId,
  creator
}) => {
  const normalizedEmail = email.toLowerCase().trim();

  /**
   * 0️⃣ Resolve active org safely
   */
  const activeOrgId = creator.activeOrganizationId || creator.organizationId;

  if (!activeOrgId) {
    throw {
      code: 400,
      message: "No active organization selected"
    };
  }

  /**
   * 1️⃣ Check if user already exists
   */
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw {
      code: 409,
      message: "User with this email already exists"
    };
  }

  /**
   * 2️⃣ Validate roles belong to active org
   */
  const roles = await Role.find({
    _id: { $in: roleIds },
    organizationId: activeOrgId
  });

  if (roles.length !== roleIds.length) {
    throw {
      code: 400,
      message: "Invalid role(s) for this organization"
    };
  }

  /**
   * 3️⃣ Create user
   */
  const user = await User.create({
    email: normalizedEmail,
    password: await genHashedPassword(password),
    organizationIds: [activeOrgId],
    activeOrganizationId: activeOrgId,
    status: "active",
    passwordChangeRequired: true
  });

  /**
   * 4️⃣ Map user to organization
   */
  await OrgUser.create({
    userId: user._id,
    organizationId: activeOrgId,
    roleIds
  });

  const employeeCode = await generateEmployeeCode(activeOrgId);
  const employee = await Employee.create({
    organizationId: activeOrgId,
    userId: user._id,
    firstName,
    lastName,
    employeeCode,
    departmentId: departmentId || undefined,
    designationId: designationId || undefined,
    dateOfJoining,
    employmentType,
    managerId: managerId || undefined,
    shiftId: shiftId || undefined,
    profileCompleted: false
  });

  await leaveBalanceService.initializeForEmployee(employee, activeOrgId);

  await sendMail(
  "employeeOnboarding",
  user.email,
  "Welcome to Luvetha HRMS",
  {
    email: user.email,
    password,
    orgName: "Luvetha",
    loginUrl: process.env.FRONTEND_LOGIN_URL
  },
  user.email
).catch((result) => {
  return result;
});


  return {
    userId: user._id,
    email: user.email
  };
};

async function generateEmployeeCode(organizationId) {
  const orgSettings = await OrgSettings.findOne({ organizationId }, "employeeIdPrefix").lean();
  const envPrefix = (process.env.EMPLOYEE_ID_PREFIX || process.env.EMPLOYEE_CODE_PREFIX || "LV").trim();
  const prefix = ((orgSettings?.employeeIdPrefix || envPrefix || "LV").trim() || "LV").toUpperCase();
  let sequence = await Employee.countDocuments(
    { organizationId, isDeleted: false }
  );

  while (true) {
    sequence += 1;
    const code = `${prefix}-${String(sequence).padStart(4, "0")}`;
    const exists = await Employee.findOne(
      { organizationId, employeeCode: code },
      "_id"
    );
    if (!exists) return code;
  }
}

exports.listByOrganization = async ({ organizationId, query }) => {
  const { page = 1, limit = 20, search } = query || {};
  const skip = (Number(page) - 1) * Number(limit);

  const userFilter = {};
  if (search) {
    userFilter.email = { $regex: search, $options: "i" };
  }

  const [memberships, total] = await Promise.all([
    OrgUser.find({ organizationId })
      .populate({
        path: "userId",
        select: "email status activeOrganizationId",
        match: userFilter
      })
      .populate({
        path: "roleIds",
        select: "name slug"
      })
      .skip(skip)
      .limit(Number(limit)),
    OrgUser.countDocuments({ organizationId })
  ]);

  const items = memberships
    .filter(m => m.userId)
    .map(m => ({
      userId: m.userId._id,
      email: m.userId.email,
      status: m.userId.status,
      activeOrganizationId: m.userId.activeOrganizationId,
      roles: m.roleIds
    }));

  return {
    items,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit)
    }
  };
};

exports.switchOrgAndRole = async ({
  user,
  organizationId,
  roleId
}) => {
  const dbUser = await User.findById(user.userId);
  if (!dbUser) {
    throw { code: 401, message: "User not found" };
  }

  const isSuperAdmin = await isSuperAdminSwitchContext({
    user,
    dbUser,
    targetOrganizationId: organizationId
  });

  if (isSuperAdmin) {
    let activeRole;

    if (roleId) {
      activeRole = await Role.findOne({
        _id: roleId,
        organizationId
      });
    } else {
      activeRole = await Role.findOne({
        slug: "org-admin",
        organizationId
      });
    }

    if (!activeRole) {
      throw {
        code: 400,
        message: "OrgAdmin role not found for organization"
      };
    }

    let membership = await OrgUser.findOne({
      userId: dbUser._id,
      organizationId
    });

    if (!membership) {
      membership = await OrgUser.create({
        userId: dbUser._id,
        organizationId,
        roleIds: [activeRole._id]
      });
    } else if (!membership.roleIds.some((assignedRoleId) => String(assignedRoleId) === String(activeRole._id))) {
      membership.roleIds.push(activeRole._id);
      await membership.save();
    }

    const token = createJwtToken({
      userId: dbUser._id,
      organizationId,
      roleIds: [activeRole._id],
      activeRoleId: activeRole._id,
    });

    await User.findByIdAndUpdate(dbUser._id, {
      activeOrganizationId: organizationId,
      lastActiveRoleId: activeRole._id
    });

    await rotateUserToken(User, dbUser._id, token, {
      organizationId,
      maxActiveLoginsPerUser: await getMaxActiveLoginsPerUser(organizationId)
    });

    return {
      token,
      organizationId,
      activeRoleId: activeRole._id,
      roles: [activeRole]
    };
  }

  /**
   * 🔒 NORMAL USER FLOW
   */
  const membership = await OrgUser.findOne({
    userId: user.userId,
    organizationId
  }).populate("roleIds");

  if (!membership) {
    throw {
      code: 403,
      message: "User does not belong to this organization"
    };
  }

  let activeRoleId;

  if (roleId) {
    const role = membership.roleIds.find(
      r => r._id.toString() === roleId
    );

    if (!role) {
      throw {
        code: 403,
        message: "Role not assigned in this organization"
      };
    }

    activeRoleId = role._id;
  } else {
    activeRoleId = membership.roleIds[0]?._id;
  }

  if (!activeRoleId) {
    throw {
      code: 400,
      message: "No role available for this organization"
    };
  }

  const token = createJwtToken({
    _id: user.userId,
    email: user.email,
    organizationId,
    roleIds: membership.roleIds.map(r => r._id),
    activeRoleId
  });

  await User.findByIdAndUpdate(user.userId, {
    activeOrganizationId: organizationId,
    lastActiveRoleId: activeRoleId
  });

  await rotateUserToken(User, user.userId, token, {
    organizationId,
    maxActiveLoginsPerUser: await getMaxActiveLoginsPerUser(organizationId)
  });

  return {
    token,
    organizationId,
    activeRoleId,
    roles: membership.roleIds
  };
};

exports.getActivePermissions = async ({ user }) => {
  if (!user?.activeRoleId) {
    throw { code: 403, message: "Active role not set" };
  }

  const role = await Role.findOne({
    _id: user.activeRoleId,
    organizationId: user.organizationId
  });

  if (!role) {
    throw { code: 404, message: "Role not found" };
  }

  if (role.isSystemRole) {
    return ["*"];
  }

  if (!role.permissionIds?.length) return [];

  const permissions = await Permission.find({
    _id: { $in: role.permissionIds },
    organizationId: user.organizationId
  }).select("code");

  return permissions.map((p) => p.code);
};

exports.getMyProfile = async ({ user }) => {
  const userDoc = await User.findById(user.userId).select("email passwordChangeRequired");
  const employee = await Employee.findOne({
    userId: user.userId,
    organizationId: user.organizationId
  }).select("_id firstName lastName employeeCode managerId profileImage");

  return {
    email: userDoc?.email || null,
    mustChangePassword: Boolean(userDoc?.passwordChangeRequired),
    employeeId: employee?._id || null,
    firstName: employee?.firstName || null,
    lastName: employee?.lastName || null,
    employeeCode: employee?.employeeCode || null,
    managerId: employee?.managerId || null,
    profileImage: employee?.profileImage || null
  };
};


const OTP_EXPIRY_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const RESET_PASSWORD_VERIFICATION_WINDOW_MS = 10 * 60 * 1000;

const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const normalizeEmail = (email) => String(email || "").toLowerCase().trim();

/**
 * SEND OTP
 */
exports.sendOtp = async ({ email }) => {
  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    throw { code: 404, message: "Email not registered" };
  }

  const otp = generateOtp();

  await User.updateOne(
    { email: normalizedEmail },
    {
      otp,
      otpTimestamp: Date.now(),
      otpAttempts: 0,
      resetPasswordVerifiedAt: null,
      resetPasswordVerifiedUntil: null
    }
  );

  await sendMail(
    "otp",
    normalizedEmail,
    "Your OTP",
    otp,
    normalizedEmail
  );
};

/**
 * VERIFY OTP
 */
exports.verifyOtp = async ({ email, otp }, options = {}) => {
  const normalizedEmail = normalizeEmail(email);
  const { forPasswordReset = false } = options;
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) throw { code: 404, message: "User not found" };

  if (!user.otp || !user.otpTimestamp) {
    throw { code: 400, message: "OTP not found. Please request a new OTP." };
  }

  if ((user.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
    throw { code: 429, message: "Maximum OTP attempts exceeded. Please request a new OTP." };
  }

  if (Date.now() - new Date(user.otpTimestamp).getTime() > OTP_EXPIRY_MS) {
    throw { code: 400, message: "OTP expired" };
  }

  if (user.otp !== otp) {
    user.otpAttempts = (user.otpAttempts || 0) + 1;
    await user.save();
    throw { code: 400, message: "Invalid OTP" };
  }

  const update = {
    otp: null,
    otpTimestamp: null,
    otpAttempts: 0
  };

  if (forPasswordReset) {
    const now = new Date();
    update.resetPasswordVerifiedAt = now;
    update.resetPasswordVerifiedUntil = new Date(
      now.getTime() + RESET_PASSWORD_VERIFICATION_WINDOW_MS
    );
  }

  await User.updateOne({ email: normalizedEmail }, update);
};

exports.resetPasswordWithOtp = async ({
  email,
  password,
  confirmPassword
}) => {
  const normalizedEmail = normalizeEmail(email);
  if (password !== confirmPassword) {
    throw { code: 400, message: "Confirm password must match password" };
  }

  const user = await User.findOne({ email: normalizedEmail }).select("+password");
  if (!user) {
    throw { code: 404, message: "User not found" };
  }

  if (
    !user.resetPasswordVerifiedUntil ||
    new Date(user.resetPasswordVerifiedUntil).getTime() < Date.now()
  ) {
    throw { code: 400, message: "OTP verification expired. Please verify OTP again." };
  }

  const isSameAsOldPassword = await checkPasswords(password, user.password);
  if (isSameAsOldPassword) {
    throw { code: 400, message: "New password cannot be the same as current password" };
  }

  const hashedPassword = await genHashedPassword(password);
  await User.updateOne(
    { email: normalizedEmail },
    {
      password: hashedPassword,
      passwordChangeRequired: false,
      passwordChangedAt: new Date(),
      otp: null,
      otpTimestamp: null,
      otpAttempts: 0,
      resetPasswordVerifiedAt: null,
      resetPasswordVerifiedUntil: null
    }
  );
};
