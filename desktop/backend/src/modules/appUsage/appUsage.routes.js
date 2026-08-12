import { postAppUsageBatchHandler } from "./appUsage.controller.js";

export const registerAppUsageRoutes = async (fastify) => {
  fastify.post(
    "/app-usage/batch",
    {
      preHandler: fastify.authenticateRequest,
      schema: {
        tags: ["App Usage"],
        summary: "Store local app usage sessions",
        security: [{ bearerAuth: [] }],
      },
    },
    postAppUsageBatchHandler
  );
};
