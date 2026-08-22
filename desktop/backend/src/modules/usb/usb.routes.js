import { getUsbControlConfig, updateUsbControlConfig } from "./usb.controller.js";

export const registerUsbRoutes = async (fastify) => {
  fastify.get(
    "/usb/control-config",
    {
      preHandler: fastify.authenticateRequest,
      schema: {
        tags: ["USB"],
        summary: "Get cached USB control settings",
        security: [{ bearerAuth: [] }],
      },
    },
    getUsbControlConfig
  );

  fastify.put(
    "/usb/control-config",
    {
      preHandler: fastify.authenticateRequest,
      schema: {
        tags: ["USB"],
        summary: "Update cached USB control settings",
        security: [{ bearerAuth: [] }],
      },
    },
    updateUsbControlConfig
  );
};
