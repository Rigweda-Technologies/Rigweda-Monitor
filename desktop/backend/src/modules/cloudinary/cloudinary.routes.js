import { getCloudinaryUploadConfig } from "./cloudinary.controller.js";

export const registerCloudinaryRoutes = async (fastify) => {
  fastify.get(
    "/cloudinary/upload-config",
    {
      preHandler: fastify.authenticateRequest,
      schema: {
        tags: ["Cloudinary"],
        summary: "Get cached Cloudinary upload settings",
        security: [{ bearerAuth: [] }],
      },
    },
    getCloudinaryUploadConfig
  );
};
