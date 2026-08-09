import crypto from "node:crypto";
import { uploadBufferToCloudinary } from "../../integrations/cloudinary.js";
import { getEmployeeProfileFromRigweda } from "../../integrations/rigweda-api.js";
import { screenshotModel } from "./screenshots.model.js";

const buildCloudinaryPublicId = ({ employeeId, dateFolder, originalFileName }) => {
  const safeFileName = originalFileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${employeeId}/${dateFolder}/screenshots/${safeFileName}`;
};

export const screenshotService = {
  async resolveEmployeeProfile(token) {
    return getEmployeeProfileFromRigweda({ token });
  },

  async listScreenshots() {
    return screenshotModel.findAll();
  },

  async createScreenshot(payload) {
    const originalFileName = payload.screenshot.filename;
    const publicId = buildCloudinaryPublicId({
      dateFolder: payload.dateFolder,
      originalFileName,
      employeeId: payload.employeeId,
    });
    const folder = `${payload.employeeId}/${payload.dateFolder}/screenshots`;

    const cloudinaryResult = await uploadBufferToCloudinary({
      buffer: payload.screenshot.buffer,
      folder,
      publicId,
      resourceType: "image",
    });

    const record = {
      id: crypto.randomUUID(),
      employeeId: payload.employeeId,
      capturedAt: payload.capturedAt,
      originalFileName,
      mimeType: payload.screenshot.mimetype,
      cloudinaryFolder: folder,
      cloudinaryPublicId: publicId,
      cloudinaryUrl: cloudinaryResult.secure_url,
      cloudinaryAssetId: cloudinaryResult.asset_id,
      createdAt: new Date().toISOString(),
    };

    return screenshotModel.create(record);
  },
};
