import { registerScreenshotRoutes } from "./modules/screenshots/screenshots.routes.js";

export const registerRoutes = async (fastify) => {
  await fastify.register(registerScreenshotRoutes, { prefix: "/api" });
};
