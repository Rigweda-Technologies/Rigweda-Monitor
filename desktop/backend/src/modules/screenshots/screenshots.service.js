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

const resolveDateFolder = (capturedAt) =>
  new Date(capturedAt).toISOString().slice(0, 10).replaceAll("-", "_");

export const screenshotService = {
  async resolveEmployeeProfile(token) {
    return getEmployeeProfileFromRigweda({ token });
  },

  async listScreenshots() {
    return screenshotModel.findAll();
  },

  async createScreenshot(payload) {
    const dateFolder = payload.dateFolder || resolveDateFolder(payload.capturedAt);
    const originalFileName = payload.screenshot.filename;
    const publicId = buildCloudinaryPublicId({
      dateFolder,
      originalFileName,
      employeeId: payload.employeeId,
    });
    const folder = `${payload.employeeId}/${dateFolder}/screenshots`;

    console.log("Uploading screenshot to Cloudinary with publicId:", publicId, "and folder:", folder);
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
      dateFolder,
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
