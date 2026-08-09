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
  const response = await fetch(`${getEnv().rigwedaApiBaseUrl}/api/users/me/profile`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return payload?.data ?? null;
};

export const authenticateRequest = async (request, reply) => {
  const token = getBearerToken(request);

  if (!token) {
    return reply.code(401).send({
      success: false,
      message: "Sign in to continue.",
    });
  }

  const secret = getEnv().jwtAccessSecret;

  if (!secret) {
    return reply.code(500).send({
      success: false,
      message: "JWT_ACCESS_SECRET is not configured.",
    });
  }

  try {
    const payload = jwt.verify(token, secret);

    request.auth = {
      token,
      userId: payload.userId || payload._id || payload.sub,
      organizationId: payload.organizationId || payload.org,
      roleKey: payload.role,
      roleIds: payload.roleIds,
      activeRoleId: payload.activeRoleId,
      sessionId: payload.sid,
    };
    return;
  } catch {
    const decoded = jwt.decode(token);
    if (decoded && typeof decoded === "object") {
      const remoteProfile = await verifyRemoteToken(token);

      if (!remoteProfile) {
        return reply.code(401).send({
          success: false,
          message: "Your access token is invalid or expired.",
        });
      }

      request.auth = {
        token,
        userId: decoded.userId || decoded._id || decoded.sub,
        organizationId: decoded.organizationId || decoded.org || remoteProfile.organizationId,
        roleKey: decoded.role,
        roleIds: decoded.roleIds,
        activeRoleId: decoded.activeRoleId,
        sessionId: decoded.sid,
        remoteToken: true,
      };
      return;
    }

    return reply.code(401).send({
      success: false,
      message: "Your access token is invalid or expired.",
    });
  }
};
