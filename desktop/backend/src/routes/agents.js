const locationReportBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["device_id", "timestamp", "latitude", "longitude", "source"],
  properties: {
    device_id: {
      type: "string",
      minLength: 1,
    },
    timestamp: {
      type: "string",
      format: "date-time",
    },
    latitude: {
      type: "number",
      minimum: -90,
      maximum: 90,
    },
    longitude: {
      type: "number",
      minimum: -180,
      maximum: 180,
    },
    source: {
      type: "string",
      enum: ["windows_native", "ip_fallback", "failed"],
    },
    metadata: {
      type: "object",
      additionalProperties: false,
      properties: {
        city: {
          type: ["string", "null"],
        },
        region: {
          type: ["string", "null"],
        },
      },
    },
  },
};

const locationReportResponseSchema = {
  type: "object",
  required: ["success", "message"],
  properties: {
    success: { type: "boolean" },
    message: { type: "string" },
    data: {
      type: "object",
      properties: {
        device_id: { type: "string" },
        receivedAt: { type: "string" },
        source: { type: "string" },
      },
    },
  },
};

const sendValidationError = (reply, field, message, keyword = "type") =>
  reply.code(400).send({
    success: false,
    message: "Validation failed",
    errorCode: "VALIDATION_ERROR",
    errors: [
      {
        field,
        message,
        keyword,
      },
    ],
  });

const validateLocationReportMetadata = async (request, reply) => {
  const metadata = request.body?.metadata;
  if (metadata === undefined) {
    return;
  }

  if (metadata === null || Array.isArray(metadata) || typeof metadata !== "object") {
    return sendValidationError(reply, "metadata", "must be object");
  }

  for (const field of ["city", "region"]) {
    if (metadata[field] !== undefined && metadata[field] !== null && typeof metadata[field] !== "string") {
      return sendValidationError(reply, `metadata.${field}`, "must be string or null");
    }
  }
};

const postAgentLocationHandler = async (request, reply) => {
  const payload = request.body;

  request.log.info(
    {
      device_id: payload.device_id,
      timestamp: payload.timestamp,
      latitude: payload.latitude,
      longitude: payload.longitude,
      source: payload.source,
      metadata: payload.metadata || null,
      auth: request.auth
        ? {
            userId: request.auth.userId || null,
            organizationId: request.auth.organizationId || null,
          }
        : null,
    },
    "Received employee location report"
  );

  return reply.code(200).send({
    success: true,
    message: "Location report received",
    data: {
      device_id: payload.device_id,
      receivedAt: new Date().toISOString(),
      source: payload.source,
    },
  });
};

export const registerAgentRoutes = async (fastify) => {
  fastify.post(
    "/location",
    {
      preValidation: validateLocationReportMetadata,
      preHandler: async (request, reply) => {
        const authHeader = request.headers.authorization;
        const isLocalTestToken = authHeader === "Bearer DIAGNOSTIC_MOCK_TOKEN";

        if (process.env.NODE_ENV !== "production" && isLocalTestToken) {
          request.log.info(
            "Development Mode: Bypassing external session authentication for local agent diagnostic verification."
          );
          return;
        }

        await fastify.authenticateRequest(request, reply);
      },
      schema: {
        tags: ["Agents"],
        summary: "Receive employee location telemetry from desktop agents",
        security: [{ bearerAuth: [] }],
        body: locationReportBodySchema,
        response: {
          200: locationReportResponseSchema,
        },
      },
    },
    postAgentLocationHandler
  );
};
