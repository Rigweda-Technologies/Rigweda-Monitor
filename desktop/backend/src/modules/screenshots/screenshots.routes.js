import {
  completeUploadSessionHandler,
  createScreenshotHandler,
  createUploadSessionHandler,
} from "./screenshots.controller.js";

export const registerScreenshotRoutes = async (fastify) => {
  fastify.post(
    "/screenshots",
    {
      preHandler: fastify.authenticateRequest,
      schema: {
        tags: ["Screenshots"],
        summary: "Upload a screenshot",
        description:
          "Authenticate with a Rigweda access token, then upload one screenshot file plus the capture timestamp.",
        security: [
          {
            bearerAuth: [],
          },
        ],
        consumes: ["multipart/form-data"],
        body: {
          type: "object",
          required: ["capturedAt"],
          properties: {
            capturedAt: {
              type: "string",
              format: "date-time",
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: { type: "object" },
            },
          },
          400: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
              errorCode: { type: "string" },
              errors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string" },
                    message: { type: "string" },
                    type: { type: "string" },
                    keyword: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    createScreenshotHandler
  );

  fastify.post(
    "/screenshot-batches/uploads",
    {
      preHandler: fastify.authenticateRequest,
      schema: {
        tags: ["Screenshots"],
        summary: "Create a signed Cloudinary batch upload session",
        description:
          "Creates durable screenshot metadata rows and returns signed Cloudinary upload parameters so the desktop agent uploads images directly to Cloudinary.",
        security: [{ bearerAuth: [] }],
      },
    },
    createUploadSessionHandler
  );

  fastify.post(
    "/screenshot-batches/:batchId/complete",
    {
      preHandler: fastify.authenticateRequest,
      schema: {
        tags: ["Screenshots"],
        summary: "Commit a completed screenshot upload batch",
        description:
          "Marks uploaded or deduplicated screenshots as complete after direct Cloudinary upload succeeds.",
        security: [{ bearerAuth: [] }],
      },
    },
    completeUploadSessionHandler
  );
};
