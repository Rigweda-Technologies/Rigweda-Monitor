import crypto from "node:crypto";
import { createSignedUploadPayload, resolveCloudinarySettings, uploadBufferToCloudinary } from "../../integrations/cloudinary.js";
import { getEmployeeProfileFromRigweda } from "../../integrations/rigweda-api.js";
import { screenshotModel } from "./screenshots.model.js";

const buildCloudinaryPublicId = ({ employeeId, dateFolder, originalFileName }) => {
  const safeFileName = originalFileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safeFileName;
};

const resolveDateFolder = (capturedAt) =>
  new Date(capturedAt).toISOString().slice(0, 10).replaceAll("-", "_");

const safePublicIdPart = (value) =>
  String(value)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const buildBatchFolder = ({ employeeId, capturedAt, folderRoot = "rigweda-monitor" }) => {
  const dateFolder = resolveDateFolder(capturedAt);
  return `${String(folderRoot || "rigweda-monitor").replace(/^\/+|\/+$/g, "")}/${employeeId}/${dateFolder}`;
};

const buildBatchPublicId = ({ capturedAt, clientScreenshotId, originalFileName, sha256 }) => {
  const timestamp = new Date(capturedAt)
    .toISOString()
    .replace(/[-:.]/g, "")
    .replace("T", "_")
    .replace("Z", "");
  const screenshotPart = safePublicIdPart(clientScreenshotId).slice(-12);
  return `${timestamp}_${screenshotPart}_${sha256.slice(0, 12)}`;
};

export const screenshotService = {
  async resolveEmployeeProfile(token) {
    return getEmployeeProfileFromRigweda({ token });
  },

  async listScreenshots() {
    return screenshotModel.findAll();
  },

  async createScreenshot(payload) {
    const cloudinarySettings = await resolveCloudinarySettings({ token: payload.auth?.token });
    const dateFolder = payload.dateFolder || resolveDateFolder(payload.capturedAt);
    const originalFileName = payload.screenshot.filename;
    const publicId = buildCloudinaryPublicId({
      dateFolder,
      originalFileName,
      employeeId: payload.employeeId,
    });
    const folder = `${String(cloudinarySettings.uploadFolderRoot || "rigweda-monitor").replace(/^\/+|\/+$/g, "")}/${payload.employeeId}/${dateFolder}`;

    console.log("Uploading screenshot to Cloudinary with publicId:", publicId, "and folder:", folder);
    const cloudinaryResult = await uploadBufferToCloudinary({
      buffer: payload.screenshot.buffer,
      token: payload.auth?.token,
      folder,
      publicId,
      resourceType: "image",
    });

    const record = {
      id: crypto.randomUUID(),
      organizationId: payload.organizationId || null,
      employeeId: payload.employeeId,
      deviceId: payload.deviceId || "legacy",
      clientScreenshotId: payload.clientScreenshotId || crypto.randomUUID(),
      capturedAt: payload.capturedAt,
      dateFolder,
      originalFileName,
      mimeType: payload.screenshot.mimetype,
      sha256: crypto.createHash("sha256").update(payload.screenshot.buffer).digest("hex"),
      sizeBytes: payload.screenshot.fileSize,
      cloudinaryFolder: folder,
      cloudinaryPublicId: publicId,
      cloudinaryUrl: cloudinaryResult.secure_url,
      cloudinaryAssetId: cloudinaryResult.asset_id,
      createdAt: new Date().toISOString(),
    };

    return screenshotModel.create(record);
  },

  async createUploadSession({ auth, batchId, deviceId, screenshots }) {
    const employeeProfile = await this.resolveEmployeeProfile(auth.token);
    const employeeId = employeeProfile?.employeeId || employeeProfile?.userId;

    if (!employeeId) {
      const error = new Error("Employee profile not found for the authenticated user.");
      error.statusCode = 404;
      throw error;
    }

    const organizationId = auth.organizationId || null;
    const firstCapturedAt = screenshots[0].capturedAt;
    const lastCapturedAt = screenshots[screenshots.length - 1].capturedAt;
    const cloudinarySettings = await resolveCloudinarySettings({ token: auth.token });

    await screenshotModel.upsertBatch({
      batchId,
      organizationId,
      employeeId,
      deviceId,
      expectedCount: screenshots.length,
      expectedBytes: screenshots.reduce((sum, item) => sum + item.sizeBytes, 0),
      firstCapturedAt,
      lastCapturedAt,
    });

    const uploads = [];

    for (const item of screenshots) {
      const existing = await screenshotModel.findUploadedByHash({
        organizationId,
        employeeId,
        sha256: item.sha256,
      });

      const folder = buildBatchFolder({
        employeeId,
        capturedAt: item.capturedAt,
        folderRoot: cloudinarySettings.uploadFolderRoot,
      });
      const publicId = buildBatchPublicId(item);

      await screenshotModel.upsertPendingScreenshot({
        id: crypto.randomUUID(),
        batchId,
        organizationId,
        employeeId,
        deviceId,
        clientScreenshotId: item.clientScreenshotId,
        capturedAt: item.capturedAt,
        originalFileName: item.originalFileName,
        mimeType: item.mimeType,
        width: item.width,
        height: item.height,
        sha256: item.sha256,
        sizeBytes: item.sizeBytes,
        cloudinaryFolder: folder,
        cloudinaryPublicId: publicId,
      });

      if (existing) {
        uploads.push({
          clientScreenshotId: item.clientScreenshotId,
          status: "duplicate",
          duplicateOf: existing.id,
          cloudinaryUrl: existing.cloudinary_url,
        });
        continue;
      }

      uploads.push({
        clientScreenshotId: item.clientScreenshotId,
        status: "upload",
        cloudinaryPublicId: publicId,
        ...(await createSignedUploadPayload({
          token: auth.token,
          folder,
          publicId,
          context: {
            batch_id: batchId,
            employee_id: employeeId,
            device_id: deviceId,
            captured_at: item.capturedAt,
            sha256: item.sha256,
          },
        })),
      });
    }

    return {
      batchId,
      employeeId,
      deviceId,
      expiresInSeconds: 300,
      uploads,
    };
  },

  async completeUploadSession({ batchId, deviceId, uploaded, duplicates }) {
    for (const upload of uploaded) {
      await screenshotModel.markUploaded({
        deviceId,
        clientScreenshotId: upload.clientScreenshotId,
        upload,
      });
    }

    for (const duplicate of duplicates) {
      await screenshotModel.markDuplicate({
        deviceId,
        clientScreenshotId: duplicate.clientScreenshotId,
        duplicateOf: duplicate.duplicateOf,
      });
    }

    return screenshotModel.completeBatch({ batchId, deviceId });
  },
};
