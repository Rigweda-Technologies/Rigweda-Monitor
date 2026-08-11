import { postActivityEventsHandler } from "./activity.controller.js";

export const registerActivityRoutes = async (fastify) => {
  fastify.post("/activity-events/batch", {
    preHandler: fastify.authenticateRequest,
    schema: { tags: ["Activity"], summary: "Store local mouse activity events", security: [{ bearerAuth: [] }] },
  }, postActivityEventsHandler);
};
