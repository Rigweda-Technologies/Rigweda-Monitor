const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const createTokenService = (env) => ({
  createAccessToken(user, sessionId) {
    return jwt.sign({ org: user.organizationId, role: user.roleKey, sid: sessionId, type: "access" }, env.JWT_ACCESS_SECRET, {
      algorithm: "HS256", subject: user.id, issuer: "rigweda-api", audience: "rigweda-web", expiresIn: env.ACCESS_TOKEN_TTL_SECONDS
    });
  },
  verifyAccessToken(token) {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms:["HS256"], issuer:"rigweda-api", audience:"rigweda-web" });
  },
  createRefreshToken() { return crypto.randomBytes(48).toString("base64url"); },
  hashRefreshToken(token) { return crypto.createHmac("sha256", env.SESSION_TOKEN_PEPPER).update(token).digest("hex"); },
  refreshExpiresAt() { return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000); }
});

module.exports = { createTokenService };
