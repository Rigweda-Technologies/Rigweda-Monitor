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
