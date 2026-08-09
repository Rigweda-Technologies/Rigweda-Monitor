const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";

/**
 * Create JWT token
 */
exports.createJwtToken = (payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid JWT payload");
  }

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN
  });
};

/**
 * Verify JWT token (used in auth middleware)
 */
exports.verifyJwtToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
