import jwt from "jsonwebtoken";
import { getEnv } from "../config/env.js";

const getBearerToken = (request) => {
  const header = request.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

const verifyRemoteToken = async (token) => {
  const hrmsBackendUrl = getEnv().hrmsBackendUrl;
  const profileUrl = hrmsBackendUrl.endsWith("/api")
    ? `${hrmsBackendUrl}/users/me/profile`
    : `${hrmsBackendUrl}/api/users/me/profile`;

  const response = await fetch(profileUrl, {
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.success === true ? payload.data ?? null : null;
};

export const authenticateRequest = async (request, reply) => {
  const token = getBearerToken(request);

  if (!token) {
    return reply.code(401).send({
      success: false,
      message: "Sign in to continue.",
    });
  }

  try {
    // HRMS owns active-session and disabled-account checks. A valid JWT signature
    // alone must never bypass revocation, including on completion endpoints.
    const profile = await verifyRemoteToken(token);
    const decoded = jwt.decode(token);
    if (!profile || !decoded || typeof decoded !== "object" || profile.mustChangePassword) {
      return reply.code(401).send({ success: false, message: "Your session is invalid or expired." });
    }
    const organizationId = decoded.organizationId || decoded.org;
    const userId = decoded.userId || decoded._id || decoded.sub;
    if (!organizationId || !userId) {
      return reply.code(403).send({ success: false, message: "An organization user session is required." });
    }
    request.auth = {
      token, userId, organizationId,
      roleKey: decoded.roleKey || decoded.role,
      roleIds: decoded.roleIds, activeRoleId: decoded.activeRoleId,
      sessionId: decoded.sid,
    };
  } catch {
    return reply.code(503).send({ success: false, message: "Session verification unavailable. Please retry." });
  }
};
