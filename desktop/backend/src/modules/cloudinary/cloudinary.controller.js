import { resolveCloudinarySettings } from "../../integrations/cloudinary.js";

export const getCloudinaryUploadConfig = async (request, reply) => {
  const data = await resolveCloudinarySettings({
    token: request.auth?.token,
    organizationId: request.auth?.organizationId,
    refresh: true,
    allowMissing: true,
  });

  if (!data) {
    return reply.code(404).send({
      success: false,
      message: "Cloudinary settings are not configured yet.",
    });
  }

  return reply.send({
    success: true,
    data,
  });
};
