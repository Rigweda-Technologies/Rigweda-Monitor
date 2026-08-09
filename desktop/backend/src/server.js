import "dotenv/config";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { validateEnv, getEnv } from "./config/env.js";
import { registerRoutes } from "./routes.js";
import { authenticateRequest } from "./middleware/auth.js";

validateEnv();
const env = getEnv();

const fastify = Fastify({
  logger: true,
});

await fastify.register(multipart, {
  attachFieldsToBody: false,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

await fastify.register(swagger, {
  openapi: {
    info: {
      title: "Rigweda Monitor API",
      description: "Employee monitoring backend APIs",
      version: "1.0.0",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    servers: [
      {
        url: "http://localhost:3000",
      },
    ],
  },
});

await fastify.register(swaggerUi, {
  routePrefix: "/docs",
  uiConfig: {
    docExpansion: "list",
    deepLinking: false,
  },
  staticCSP: true,
  transformSpecificationClone: true,
});

fastify.decorate("authenticateRequest", authenticateRequest);

await registerRoutes(fastify);

const start = async () => {
  try {
    await fastify.listen({ port: env.port, host: env.host });
    fastify.log.info(`Server listening on http://${env.host}:${env.port}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

start();
