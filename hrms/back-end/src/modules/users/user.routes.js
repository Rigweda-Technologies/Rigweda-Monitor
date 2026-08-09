const router = require("express").Router();
const asyncHandler = require("../../middlewares/asyncHandler");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const { publicLimiter } = require("../../middlewares/rateLimiter");

const controller = require("./user.controller");
const validator = require("./user.validator");

router.post(
  "/login",
  publicLimiter,
  validate(validator.loginSchema),
  asyncHandler(controller.login)
);

router.post(
  "/login/selfie",
  publicLimiter,
  validate(validator.loginWithSelfieSchema),
  asyncHandler(controller.loginWithSelfie)
);

router.get(
  "/",
  auth,
  authorize("USER_VIEW"),
  asyncHandler(controller.listByOrganization)
);

router.post(
  "/org-user",
  auth,
  authorize("USER_CREATE"),
  validate(validator.createUserSchema),
  asyncHandler(controller.createUser)
);

router.post(
  "/switch-org",
  auth,
  validate(validator.switchOrgSchema),
  asyncHandler(controller.switchOrganization)
);

router.get(
  "/me/permissions",
  auth,
  asyncHandler(controller.myPermissions)
);

router.get(
  "/me/profile",
  auth,
  asyncHandler(controller.myProfile)
);

router.post(
  "/send-otp",
  publicLimiter,
  validate(validator.sendOTPUserSchema),
  asyncHandler(controller.sendOtp)
);
router.post(
  "/verify-otp",
  publicLimiter,
  validate(validator.validateOTPSchema),
  asyncHandler(controller.verifyOtp)
);
router.post(
  "/forgot-password/send-otp",
  publicLimiter,
  validate(validator.sendOTPUserSchema),
  asyncHandler(controller.forgotPasswordSendOtp)
);
router.post(
  "/forgot-password/verify-otp",
  publicLimiter,
  validate(validator.validateOTPSchema),
  asyncHandler(controller.forgotPasswordVerifyOtp)
);
router.post(
  "/forgot-password/reset-password",
  publicLimiter,
  validate(validator.resetPasswordSchema),
  asyncHandler(controller.resetPasswordWithOtp)
);
router.post(
  "/change-password/send-otp",
  auth,
  publicLimiter,
  asyncHandler(controller.sendChangePasswordOtp)
);
router.post(
  "/change-password/verify-otp",
  auth,
  publicLimiter,
  validate(validator.verifyOtpOnlySchema),
  asyncHandler(controller.verifyChangePasswordOtp)
);
router.post(
  "/change-password/update",
  auth,
  publicLimiter,
  validate(validator.updatePasswordAuthSchema),
  asyncHandler(controller.updatePasswordWithOtp)
);


module.exports = router;
