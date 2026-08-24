import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { loadEnvFiles, validateEnv, getEnv } from "./config/env.js";
import { initializeDatabase } from "./database/schema.js";
import { registerRoutes } from "./routes.js";
import { authenticateRequest } from "./middleware/auth.js";

loadEnvFiles();
validateEnv();
const env = getEnv();
await initializeDatabase();

const fastify = Fastify({
  logger: true,
});

await fastify.register(cors, {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    if (env.corsOrigins.length === 0) {
      return callback(null, false);
    }

    const allowed = env.corsOrigins.some((allowedOrigin) => allowedOrigin === origin);
    callback(null, allowed);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
});

await fastify.register(multipart, {
  attachFieldsToBody: "keyValues",
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
        url: env.rigwedaBackendApiBaseUrl || `http://${env.host}:${env.port}`,
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

fastify.setErrorHandler((error, request, reply) => {
  if (error.validation) {
    return reply.code(400).send({
      success: false,
      message: "Validation failed",
      errorCode: "VALIDATION_ERROR",
      errors: error.validation.map((item) => ({
        field: item.instancePath ? item.instancePath.replace(/^\//, "").replaceAll("/", ".") : "body",
        message: item.message,
        keyword: item.keyword,
      })),
    });
  }

  request.log.error(error);
  return reply.code(error.statusCode || 500).send({
    success: false,
    message: error.message || "Internal Server Error",
    errorCode: error.code || "INTERNAL_SERVER_ERROR",
  });
});

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
