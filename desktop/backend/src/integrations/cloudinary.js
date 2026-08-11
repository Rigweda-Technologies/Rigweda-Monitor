import { v2 as cloudinary } from "cloudinary";
import { getEnv } from "../config/env.js";
import { getMonitorCloudinarySettingsFromRigweda } from "./rigweda-api.js";

let configuredKey = null;

const envCredentials = () => {
  const env = getEnv();
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    return null;
  }
  return {
    cloudName: env.cloudinaryCloudName,
    apiKey: env.cloudinaryApiKey,
    apiSecret: env.cloudinaryApiSecret,
    uploadFolderRoot: "rigweda-monitor",
  };
};

const configure = (settings) => {
  const key = `${settings.cloudName}:${settings.apiKey}`;
  if (configuredKey === key) {
    return;
  }

  cloudinary.config({
    cloud_name: settings.cloudName,
    api_key: settings.apiKey,
    api_secret: settings.apiSecret,
    secure: true,
  });
  configuredKey = key;
};

export const resolveCloudinarySettings = async ({ token } = {}) => {
  if (token) {
    const settings = await getMonitorCloudinarySettingsFromRigweda({ token });
    configure(settings);
    return settings;
  }

  const settings = envCredentials();
  if (!settings) {
    throw new Error("Cloudinary settings are missing. Configure Employee Monitor > Settings in HRMS.");
  }
  configure(settings);
  return settings;
};

export const uploadBufferToCloudinary = async ({ token, buffer, folder, publicId, resourceType }) => {
  await resolveCloudinarySettings({ token });

  return new Promise((resolve, reject) => {
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
};

export const createSignedUploadPayload = async ({ token, folder, publicId, context = {} }) => {
  const settings = await resolveCloudinarySettings({ token });
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
    cloudName: settings.cloudName,
    apiKey: settings.apiKey,
    uploadUrl: `https://api.cloudinary.com/v1_1/${settings.cloudName}/image/upload`,
    params: {
      ...params,
      signature: cloudinary.utils.api_sign_request(params, settings.apiSecret),
    },
  };
};
