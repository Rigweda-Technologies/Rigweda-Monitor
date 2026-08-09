import { v2 as cloudinary } from "cloudinary";
import { getEnv } from "../config/env.js";

let isConfigured = false;

const ensureConfigured = () => {
  if (isConfigured) {
    return;
  }

  const env = getEnv();
  cloudinary.config({
    cloud_name: env.cloudinaryCloudName,
    api_key: env.cloudinaryApiKey,
    api_secret: env.cloudinaryApiSecret,
    secure: true,
  });
  isConfigured = true;
};

export const uploadBufferToCloudinary = ({ buffer, folder, publicId, resourceType }) =>
  new Promise((resolve, reject) => {
    ensureConfigured();

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });

export const createSignedUploadPayload = ({ folder, publicId, context = {} }) => {
  ensureConfigured();
  const env = getEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    folder,
    public_id: publicId,
    timestamp,
  };

  if (Object.keys(context).length > 0) {
    params.context = Object.entries(context)
      .map(([key, value]) => `${key}=${String(value).replaceAll("|", " ")}`)
      .join("|");
  }

  return {
    cloudName: env.cloudinaryCloudName,
    apiKey: env.cloudinaryApiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/upload`,
    params: {
      ...params,
      signature: cloudinary.utils.api_sign_request(params, env.cloudinaryApiSecret),
    },
  };
};
