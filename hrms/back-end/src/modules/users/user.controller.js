const userService = require("./user.service");
const {
  buildSuccessResponse,
  buildFailureResponse
} = require("../../utils/responseBuilder");

exports.login = async (req, res) => {
  try {
    const result = await userService.loginUser(req.body);
    res.setHeader("Authorization", result?.token);
    delete result.token;
    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Login successful",
        data: result
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Login failed",
        error: err.error || null
      })
    );
  }
};

exports.loginWithSelfie = async (req, res) => {
  try {
    const result = await userService.loginUserWithSelfie(req.body);
    res.setHeader("Authorization", result?.token);
    delete result.token;
    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Selfie login successful",
        data: result
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Selfie login failed",
        error: err.error || null
      })
    );
  }
};

exports.listByOrganization = async (req, res) => {
  try {
    const data = await userService.listByOrganization({
      organizationId: req.user.organizationId,
      query: req.query
    });

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Users fetched successfully",
        data
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Failed to fetch users",
        error: err.error || null
      })
    );
  }
};

exports.createUser = async (req, res) => {
  try {
    const result = await userService.createOrgUser({
      ...req.body,
      creator: req.user
    });

    return res.status(201).json(
      buildSuccessResponse({
        code: 201,
        message: "User created successfully",
        data: result
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "User creation failed",
        error: err.error || null
      })
    );
  }
};

exports.switchOrganization = async (req, res) => {
  try {
    const result = await userService.switchOrgAndRole({
      user: req.user,
      organizationId: req.body.organizationId,
    });
    res.setHeader("Authorization", result?.token);
    delete result.token;

    return res.status(200).json(
      buildSuccessResponse({
        code: 200,
        message: "Context switched successfully",
        data: result
      })
    );
  } catch (err) {
    return res.status(err.code || 500).json(
      buildFailureResponse({
        code: err.code || 500,
        message: err.message || "Failed to switch context",
        error: err.error || null
      })
    );
  }
};

exports.sendOtp = async (req, res) => {
  await userService.sendOtp(req.body);
  return res.json(
    buildSuccessResponse({
      message: "OTP sent successfully"
    })
  );
};

exports.verifyOtp = async (req, res) => {
  await userService.verifyOtp(req.body);
  return res.json(
    buildSuccessResponse({
      message: "OTP verified successfully"
    })
  );
};

exports.forgotPasswordSendOtp = async (req, res) => {
  await userService.sendOtp(req.body);
  return res.json(
    buildSuccessResponse({
      message: "OTP sent successfully"
    })
  );
};

exports.forgotPasswordVerifyOtp = async (req, res) => {
  await userService.verifyOtp(req.body, { forPasswordReset: true });
  return res.json(
    buildSuccessResponse({
      message: "OTP verified successfully"
    })
  );
};

exports.resetPasswordWithOtp = async (req, res) => {
  await userService.resetPasswordWithOtp(req.body);
  return res.json(
    buildSuccessResponse({
      message: "Password updated successfully"
    })
  );
};

exports.sendChangePasswordOtp = async (req, res) => {
  await userService.sendOtp({ email: req.user.email });
  return res.json(
    buildSuccessResponse({
      message: "OTP sent successfully"
    })
  );
};

exports.verifyChangePasswordOtp = async (req, res) => {
  await userService.verifyOtp(
    { email: req.user.email, otp: req.body.otp },
    { forPasswordReset: true }
  );
  return res.json(
    buildSuccessResponse({
      message: "OTP verified successfully"
    })
  );
};

exports.updatePasswordWithOtp = async (req, res) => {
  await userService.resetPasswordWithOtp({
    email: req.user.email,
    password: req.body.password,
    confirmPassword: req.body.confirmPassword
  });
  return res.json(
    buildSuccessResponse({
      message: "Password updated successfully"
    })
  );
};

exports.myPermissions = async (req, res) => {
  const data = await userService.getActivePermissions({ user: req.user });
  return res.status(200).json(
    buildSuccessResponse({
      data
    })
  );
};

exports.myProfile = async (req, res) => {
  const data = await userService.getMyProfile({ user: req.user });
  return res.status(200).json(
    buildSuccessResponse({
      data
    })
  );
};
