const jwt = require("jsonwebtoken");
const User = require("../modules/users/user.model");

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: 401,
        message: "Authorization token missing",
        data: null,
        error: null
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.userId || decoded._id;
    
    const user = await User.findById(userId).select(
      "_id email organizationIds activeOrganizationId status tokenList passwordChangeRequired"
    );

    // console.log(user, decoded);

    if (!user) {
      return res.status(401).json({
        success: false,
        code: 401,
        message: "User not found",
        data: null,
        error: null
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        code: 403,
        message: "User account is not active",
        data: null,
        error: null
      });
    }

    const hasMatchingActiveToken = Array.isArray(user.tokenList) && user.tokenList.some((entry) => {
      if (!entry?.token || entry.token !== token) return false;
      if (entry.status && entry.status !== "active") return false;
      if (decoded.organizationId && entry.organizationId) {
        return String(entry.organizationId) === String(decoded.organizationId);
      }
      return true;
    });

    if (!hasMatchingActiveToken) {
      return res.status(401).json({
        success: false,
        code: 401,
        message: "Session expired. Please login again.",
        data: null,
        error: null
      });
    }

    // org-scoped context
    req.user = {
      userId: user._id,
      email: user.email,
      organizationId: decoded.organizationId,
      roleIds: decoded.roleIds,
      activeRoleId: decoded.activeRoleId,
      mustChangePassword: Boolean(user.passwordChangeRequired)
    };

    if (user.passwordChangeRequired) {
      const allowedRoutePrefixes = [
        "/api/users/change-password/send-otp",
        "/api/users/change-password/verify-otp",
        "/api/users/change-password/update",
        "/api/users/me/profile",
        "/api/users/me/permissions"
      ];
      const requestPath = req.originalUrl.split("?")[0];

      const isAllowed = allowedRoutePrefixes.some((prefix) =>
        requestPath.startsWith(prefix)
      );

      if (!isAllowed) {
        return res.status(403).json({
          success: false,
          code: 403,
          message: "Password change required before continuing.",
          data: {
            mustChangePassword: true
          },
          error: null
        });
      }
    }

    req.token = token;

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      code: 401,
      message: "Invalid or expired token",
      data: null,
      error: err.message
    });
  }
};
