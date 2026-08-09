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

export const authenticateRequest = (request, reply, done) => {
  const token = getBearerToken(request);

  if (!token) {
    reply.code(401).send({
      success: false,
      message: "Sign in to continue.",
    });
    return;
  }

  const secret = getEnv().jwtAccessSecret;

  if (!secret) {
    reply.code(500).send({
      success: false,
      message: "JWT_ACCESS_SECRET is not configured.",
    });
    return;
  }

  try {
    const payload = jwt.verify(token, secret);

    console.log("Authentication successful for token:", payload);
    request.auth = {
      token,
      userId: payload.sub,
      organizationId: payload.org,
      roleKey: payload.role,
      sessionId: payload.sid,
    };

    
    done();
  } catch {
    console.log("Authentication failed for token:", token);
    reply.code(401).send({
      success: false,
      message: "Your access token is invalid or expired.",
    });
  }
};
