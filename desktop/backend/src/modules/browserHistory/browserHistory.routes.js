import { postBrowserHistoryBatchHandler } from "./browserHistory.controller.js";

export const registerBrowserHistoryRoutes = async (fastify) => {
  fastify.post(
    "/browser-history/batch",
    {
      preHandler: fastify.authenticateRequest,
      schema: {
        tags: ["Browser History"],
        summary: "Store browser history batch",
        security: [{ bearerAuth: [] }],
      },
    },
    postBrowserHistoryBatchHandler
  );
};
