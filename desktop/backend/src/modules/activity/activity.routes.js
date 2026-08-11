import { listActivityEmployeesHandler, postActivityEventsHandler } from "./activity.controller.js";

export const registerActivityRoutes = async (fastify) => {
  fastify.post("/activity-events/batch", {
    preHandler: fastify.authenticateRequest,
    schema: { tags: ["Activity"], summary: "Store local mouse activity events", security: [{ bearerAuth: [] }] },
  }, postActivityEventsHandler);

  fastify.get("/activity/employees", {
    preHandler: fastify.authenticateRequest,
    schema: { tags: ["Activity"], summary: "List employee activity and presence", security: [{ bearerAuth: [] }] },
  }, listActivityEmployeesHandler);
};
