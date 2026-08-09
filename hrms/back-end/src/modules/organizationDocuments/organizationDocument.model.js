const mongoose = require("mongoose");

const uploadHistorySchema = new mongoose.Schema(
  {
    filePath: String,
    publicId: String,
    resourceType: String,
    fileType: String,
    fileName: String,
    fileSize: Number,
    documentNumber: String,
    expiryDate: Date,
    remarks: String,
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users"
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    action: {
      type: String,
      enum: ["UPLOAD", "REPLACE", "DELETE"],
      default: "UPLOAD"
    }
  },
  { _id: false }
);

const organizationDocumentSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },
    documentCategory: {
      type: String,
      required: true
    },
    documentKey: {
      type: String,
      required: true
    },
    documentName: {
      type: String,
      required: true
    },
    documentNumber: {
      type: String,
      default: ""
    },
    filePath: {
      type: String,
      required: true
    },
    publicId: {
      type: String,
      required: true
    },
    resourceType: {
      type: String,
      default: "auto"
    },
    fileType: {
      type: String,
      required: true
    },
    fileName: {
      type: String,
      required: true
    },
    fileSize: {
      type: Number,
      default: 0
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    expiryDate: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ["ACTIVE", "EXPIRED", "PENDING"],
      default: "ACTIVE"
    },
    remarks: {
      type: String,
      default: ""
    },
    isDeleted: {
      type: Boolean,
      default: false
    },
    deletedAt: {
      type: Date,
      default: null
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null
    },
    uploadHistory: {
      type: [uploadHistorySchema],
      default: []
    }
  },
  {
    timestamps: true,
    collection: "organization_documents"
  }
);

organizationDocumentSchema.index(
  { organizationId: 1, documentKey: 1, isDeleted: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
organizationDocumentSchema.index({ organizationId: 1, status: 1 });
organizationDocumentSchema.index({ organizationId: 1, expiryDate: 1 });

module.exports = mongoose.model("organization_documents", organizationDocumentSchema);
