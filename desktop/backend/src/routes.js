import { registerScreenshotRoutes } from "./modules/screenshots/screenshots.routes.js";
import { registerActivityRoutes } from "./modules/activity/activity.routes.js";
import { registerCloudinaryRoutes } from "./modules/cloudinary/cloudinary.routes.js";

export const registerRoutes = async (fastify) => {
  fastify.get("/", async () => ({
    message: "Rigweda Monitor API is running",
    docs: "/docs",
    health: "/api/health",
  }));

  fastify.get("/api/health", async () => ({
    message: "OK",
    status: "healthy",
  }));

  await fastify.register(registerScreenshotRoutes, { prefix: "/api" });
  await fastify.register(registerActivityRoutes, { prefix: "/api" });
  await fastify.register(registerCloudinaryRoutes, { prefix: "/api" });
};
