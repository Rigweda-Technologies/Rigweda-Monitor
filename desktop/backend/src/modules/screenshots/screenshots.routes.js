import { createScreenshotHandler, listScreenshotsHandler } from "./screenshots.controller.js";

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
          required: ["capturedAt", "screenshot"],
          properties: {
            capturedAt: {
              type: "string",
              format: "date-time",
            },
            screenshot: {
              // type: "string",
              format: "binary",
              description: "The screenshot image file to upload.",
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
            },
          },
        },
      },
    },
    createScreenshotHandler
  );
};
