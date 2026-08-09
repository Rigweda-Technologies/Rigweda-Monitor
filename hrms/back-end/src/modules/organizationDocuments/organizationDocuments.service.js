const OrganizationDocument = require("./organizationDocument.model");
const OrgUser = require("../organizations/org-user.model");
const Role = require("../roles/role.model");
const Notification = require("../notifications/notification.model");
const { DOCUMENT_CATEGORIES, DOCUMENT_TYPES, DOCUMENT_TYPE_BY_KEY } = require("./organizationDocuments.catalog");
const { MAX_FILE_SIZE_BYTES, ALLOWED_MIME_TYPES } = require("./organizationDocuments.validation");
const { uploadDataUri, buildAuthenticatedUrl, deleteAsset } = require("../../config/cloudinary");

const EXPIRING_SOON_DAYS = 30;

const normalizeStatus = (expiryDate) => {
  if (!expiryDate) return "ACTIVE";
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return new Date(expiryDate) < endOfToday ? "EXPIRED" : "ACTIVE";
};

const isDocumentRequired = (docType, { esicApplicable = true } = {}) => {
  if (!docType?.mandatory) return false;
  if (docType.conditional === "ESIC_APPLICABLE") return Boolean(esicApplicable);
  return true;
};

const validateUploadPayload = (file) => {
  if (!file?.base64Data || !file?.mimeType || !file?.fileName) {
    const error = new Error("Document file is required");
    error.statusCode = 400;
    throw error;
  }
  if (!ALLOWED_MIME_TYPES.includes(file.mimeType)) {
    const error = new Error("Unsupported file type. Upload PDF, JPG, PNG, or DOCX files only.");
    error.statusCode = 400;
    throw error;
  }
  if (Number(file.size || 0) > MAX_FILE_SIZE_BYTES) {
    const error = new Error("File size exceeds the 8MB limit");
    error.statusCode = 413;
    throw error;
  }
};

const uploadDocumentToCloudinary = async (dataUri, options) => {
  try {
    return await uploadDataUri(dataUri, options);
  } catch (err) {
    const message = String(err?.message || "");
    const error = new Error(
      message.includes("Must supply api_key")
        ? "Cloudinary credentials are missing or invalid"
        : message || "Cloudinary upload failed"
    );
    error.statusCode = 502;
    throw error;
  }
};

const buildSignedUrls = (doc) => {
  const previewUrl = buildAuthenticatedUrl(doc.publicId, {
    resourceType: doc.resourceType || "auto",
    expiresInSeconds: 10 * 60
  });
  const downloadUrl = buildAuthenticatedUrl(doc.publicId, {
    resourceType: doc.resourceType || "auto",
    expiresInSeconds: 10 * 60,
    flags: "attachment"
  });
  return { previewUrl, downloadUrl };
};

const serializeDocument = (doc, { includeHistory = false } = {}) => {
  const plain = typeof doc.toObject === "function" ? doc.toObject() : doc;
  return {
    ...plain,
    status: normalizeStatus(plain.expiryDate),
    uploadHistory: includeHistory ? plain.uploadHistory || [] : undefined
  };
};

const buildCatalogWithState = (documents, options = {}) => {
  const docByKey = new Map(documents.map((doc) => [doc.documentKey, doc]));
  return DOCUMENT_CATEGORIES.map((category) => ({
    category,
    documents: DOCUMENT_TYPES
      .filter((docType) => docType.category === category)
      .map((docType) => {
        const uploaded = docByKey.get(docType.key);
        return {
          ...docType,
          mandatory: isDocumentRequired(docType, options),
          uploaded: Boolean(uploaded),
          currentDocument: uploaded || null
        };
      })
  }));
};

const getActiveDocuments = async (organizationId) => {
  const docs = await OrganizationDocument.find({
    organizationId,
    isDeleted: false
  }).sort({ documentCategory: 1, documentName: 1 }).lean();

  const expiredIds = docs
    .filter((doc) => doc.status !== "EXPIRED" && normalizeStatus(doc.expiryDate) === "EXPIRED")
    .map((doc) => doc._id);
  if (expiredIds.length) {
    await OrganizationDocument.updateMany({ _id: { $in: expiredIds } }, { $set: { status: "EXPIRED" } });
  }

  return docs.map((doc) => ({ ...doc, status: normalizeStatus(doc.expiryDate) }));
};

exports.getCatalog = async (req) => {
  const esicApplicable = req.query.esicApplicable !== "false";
  const documents = await getActiveDocuments(req.user.organizationId);
  return buildCatalogWithState(documents, { esicApplicable });
};

exports.list = async (req) => {
  const { category, status, search, includeHistory, esicApplicable } = req.query;
  const query = {
    organizationId: req.user.organizationId,
    isDeleted: false
  };
  if (category) query.documentCategory = category;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { documentName: { $regex: search, $options: "i" } },
      { documentNumber: { $regex: search, $options: "i" } },
      { remarks: { $regex: search, $options: "i" } }
    ];
  }

  const docs = await OrganizationDocument.find(query)
    .sort({ documentCategory: 1, documentName: 1 })
    .populate("uploadedBy", "email")
    .lean();

  const serialized = docs.map((doc) => serializeDocument(doc, { includeHistory }));
  return {
    items: serialized,
    catalog: buildCatalogWithState(serialized, { esicApplicable: esicApplicable !== "false" })
  };
};

exports.summary = async (req) => {
  const esicApplicable = req.query.esicApplicable !== "false";
  const docs = await getActiveDocuments(req.user.organizationId);
  const now = new Date();
  const soon = new Date(now);
  soon.setDate(soon.getDate() + EXPIRING_SOON_DAYS);
  const uploadedKeys = new Set(docs.map((doc) => doc.documentKey));
  const missingMandatory = DOCUMENT_TYPES.filter((docType) => isDocumentRequired(docType, { esicApplicable }) && !uploadedKeys.has(docType.key));
  const expired = docs.filter((doc) => normalizeStatus(doc.expiryDate) === "EXPIRED");
  const expiringSoon = docs.filter((doc) => {
    if (!doc.expiryDate || normalizeStatus(doc.expiryDate) === "EXPIRED") return false;
    const date = new Date(doc.expiryDate);
    return date >= now && date <= soon;
  });

  return {
    totalUploadedDocuments: docs.length,
    missingMandatoryDocuments: missingMandatory.length,
    expiredDocuments: expired.length,
    expiringSoonDocuments: expiringSoon.length,
    missingMandatory,
    expired,
    expiringSoon
  };
};

exports.missing = async (req) => {
  const esicApplicable = req.query.esicApplicable !== "false";
  const docs = await getActiveDocuments(req.user.organizationId);
  const uploadedKeys = new Set(docs.map((doc) => doc.documentKey));
  return DOCUMENT_TYPES.filter((docType) => isDocumentRequired(docType, { esicApplicable }) && !uploadedKeys.has(docType.key));
};

exports.expiringSoon = async (req) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days || EXPIRING_SOON_DAYS)));
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + days);
  const docs = await OrganizationDocument.find({
    organizationId: req.user.organizationId,
    isDeleted: false,
    expiryDate: { $ne: null, $gte: now, $lte: cutoff }
  }).sort({ expiryDate: 1 }).lean();

  return docs.map((doc) => serializeDocument(doc));
};

exports.uploadOrReplace = async (req) => {
  const docType = DOCUMENT_TYPE_BY_KEY[req.body.documentKey];
  if (!docType) throw new Error("Invalid document type");
  validateUploadPayload(req.body.file);

  const dataUri = `data:${req.body.file.mimeType};base64,${req.body.file.base64Data}`;
  const uploaded = await uploadDocumentToCloudinary(dataUri, {
    folder: `hrms/organization-documents/${req.user.organizationId}`,
    type: "authenticated",
    resource_type: "auto",
    use_filename: true,
    unique_filename: true
  });

  const existing = await OrganizationDocument.findOne({
    organizationId: req.user.organizationId,
    documentKey: docType.key,
    isDeleted: false
  });

  const historyItem = {
    filePath: uploaded.secure_url,
    publicId: uploaded.public_id,
    resourceType: uploaded.resource_type || "auto",
    fileType: req.body.file.mimeType,
    fileName: req.body.file.fileName,
    fileSize: req.body.file.size,
    documentNumber: req.body.documentNumber || "",
    expiryDate: req.body.expiryDate || null,
    remarks: req.body.remarks || "",
    uploadedBy: req.user.userId,
    uploadedAt: new Date(),
    action: existing ? "REPLACE" : "UPLOAD"
  };

  const payload = {
    organizationId: req.user.organizationId,
    documentCategory: docType.category,
    documentKey: docType.key,
    documentName: docType.name,
    documentNumber: req.body.documentNumber || "",
    filePath: uploaded.secure_url,
    publicId: uploaded.public_id,
    resourceType: uploaded.resource_type || "auto",
    fileType: req.body.file.mimeType,
    fileName: req.body.file.fileName,
    fileSize: req.body.file.size,
    uploadedBy: req.user.userId,
    uploadedAt: new Date(),
    expiryDate: req.body.expiryDate || null,
    status: normalizeStatus(req.body.expiryDate),
    remarks: req.body.remarks || "",
    isDeleted: false,
    deletedAt: null,
    deletedBy: null
  };

  let doc;
  if (existing) {
    existing.uploadHistory.push(historyItem);
    Object.assign(existing, payload);
    doc = await existing.save();
  } else {
    doc = await OrganizationDocument.create({
      ...payload,
      uploadHistory: [historyItem]
    });
  }

  return serializeDocument(doc, { includeHistory: true });
};

exports.updateMetadata = async (req) => {
  const doc = await OrganizationDocument.findOneAndUpdate(
    {
      _id: req.params.id,
      organizationId: req.user.organizationId,
      isDeleted: false
    },
    {
      $set: {
        documentNumber: req.body.documentNumber || "",
        expiryDate: req.body.expiryDate || null,
        remarks: req.body.remarks || "",
        status: normalizeStatus(req.body.expiryDate)
      }
    },
    { new: true }
  );
  if (!doc) throw new Error("Document not found");
  return serializeDocument(doc);
};

exports.getSignedAccess = async (req) => {
  const doc = await OrganizationDocument.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    isDeleted: false
  }).lean();
  if (!doc) throw new Error("Document not found");
  return serializeDocument(doc);
};

exports.getDocumentStreamAccess = async (req) => {
  const doc = await OrganizationDocument.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    isDeleted: false
  }).lean();
  if (!doc) {
    const error = new Error("Document not found");
    error.statusCode = 404;
    throw error;
  }

  const urls = buildSignedUrls(doc);
  return {
    doc,
    url: req.query.download === "true" ? urls.downloadUrl : urls.previewUrl
  };
};

exports.deleteById = async (req) => {
  const doc = await OrganizationDocument.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    isDeleted: false
  });
  if (!doc) throw new Error("Document not found");

  doc.uploadHistory.push({
    filePath: doc.filePath,
    publicId: doc.publicId,
    resourceType: doc.resourceType,
    fileType: doc.fileType,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    documentNumber: doc.documentNumber,
    expiryDate: doc.expiryDate,
    remarks: doc.remarks,
    uploadedBy: req.user.userId,
    uploadedAt: new Date(),
    action: "DELETE"
  });
  doc.isDeleted = true;
  doc.deletedAt = new Date();
  doc.deletedBy = req.user.userId;
  await doc.save();

  try {
    await deleteAsset(doc.publicId, { resourceType: doc.resourceType || "auto" });
  } catch (_) {
    // Keep the database delete successful even if Cloudinary cleanup has to be retried manually.
  }

  return { deleted: true };
};

exports.notifyExpiringDocuments = async () => {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + EXPIRING_SOON_DAYS);

  const docs = await OrganizationDocument.find({
    isDeleted: false,
    expiryDate: { $ne: null, $gte: now, $lte: cutoff },
    status: { $ne: "EXPIRED" }
  }).lean();

  let sent = 0;
  for (const doc of docs) {
    const adminRoles = await Role.find({
      organizationId: doc.organizationId,
      slug: { $in: ["admin", "hr", "super_admin"] }
    }).select("_id").lean();
    const roleIds = adminRoles.map((role) => role._id);
    if (!roleIds.length) continue;

    const memberships = await OrgUser.find({
      organizationId: doc.organizationId,
      roleIds: { $in: roleIds }
    }).select("userId").lean();

    for (const membership of memberships) {
      const recent = await Notification.findOne({
        organizationId: doc.organizationId,
        recipientUserId: membership.userId,
        type: "organization_document_expiry",
        "meta.documentId": String(doc._id),
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }).select("_id").lean();
      if (recent) continue;

      await Notification.create({
        organizationId: doc.organizationId,
        recipientUserId: membership.userId,
        type: "organization_document_expiry",
        title: "Document expiring soon",
        message: `${doc.documentName} expires on ${new Date(doc.expiryDate).toISOString().slice(0, 10)}.`,
        meta: {
          documentId: String(doc._id),
          documentKey: doc.documentKey,
          expiryDate: doc.expiryDate
        }
      });
      sent += 1;
    }
  }

  return sent;
};
