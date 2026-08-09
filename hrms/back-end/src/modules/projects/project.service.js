const Project = require("./project.model");
const Employee = require("../employees/employee.model");
const { audit } = require("../auditLogs/auditLogs.service");
const { uploadDataUri } = require("../../config/cloudinary");

const toKey = (value) => String(value || "").trim().toLowerCase();

const toAmount = (value, defaultValue = 0) => {
  if (value === undefined || value === null || value === "") return Number(defaultValue);
  return Number(value);
};

const computeAmounts = ({ actualAmount, discountedAmount, paidAmount }) => {
  const actual = toAmount(actualAmount);
  const discounted = toAmount(discountedAmount);
  const paid = toAmount(paidAmount, 0);

  if (Number.isNaN(actual) || Number.isNaN(discounted) || Number.isNaN(paid)) {
    throw { code: 400, message: "Invalid amount values" };
  }
  if (actual < 0 || discounted < 0 || paid < 0) {
    throw { code: 400, message: "Amounts cannot be negative" };
  }
  if (discounted > actual) {
    throw { code: 400, message: "Discounted amount cannot exceed actual amount" };
  }
  if (paid > discounted) {
    throw { code: 400, message: "Paid amount cannot exceed discounted amount" };
  }

  return {
    actualAmount: actual,
    discountedAmount: discounted,
    paidAmount: paid,
    pendingAmount: discounted - paid
  };
};

const resolvePaidTo = async ({ organizationId, paidTo }) => {
  if (!paidTo) {
    throw { code: 400, message: "Paid To employee is required" };
  }

  const employee = await Employee.findOne({
    _id: paidTo,
    organizationId
  }).select("_id");

  if (!employee) {
    throw { code: 400, message: "Paid To employee not found" };
  }

  return employee._id;
};

const uploadProjectFile = async (uploadPayload, folder, fallbackName) => {
  if (!uploadPayload?.base64Data || !uploadPayload?.mimeType) return undefined;

  const dataUri = `data:${uploadPayload.mimeType};base64,${uploadPayload.base64Data}`;
  const isPdf = String(uploadPayload.mimeType).toLowerCase() === "application/pdf";
  const uploaded = await uploadDataUri(dataUri, {
    folder,
    resource_type: isPdf ? "raw" : "auto"
  });

  return {
    fileName: uploadPayload.fileName || fallbackName,
    fileUrl: uploaded?.secure_url || "",
    mimeType: uploadPayload.mimeType || "",
    uploadedAt: new Date()
  };
};

exports.create = async (req) => {
  const organizationId = req.user.organizationId;
  const projectNameKey = toKey(req.body.projectName);

  const exists = await Project.findOne({ organizationId, projectNameKey }).select("_id");
  if (exists) {
    throw { code: 409, message: "Project name already exists" };
  }

  const amounts = computeAmounts(req.body);
  const paidTo = await resolvePaidTo({
    organizationId,
    paidTo: req.body.paidTo || null
  });
  const mouFile = await uploadProjectFile(
    req.body.mouUpload,
    "hrms/project-mou-files",
    "project-mou"
  );
  const documentationFile = await uploadProjectFile(
    req.body.documentationUpload,
    "hrms/project-documentation-files",
    "project-documentation"
  );
  const project = await Project.create({
    organizationId,
    projectName: req.body.projectName,
    projectNameKey,
    logoUrl: req.body.logoUrl || "",
    clientName: req.body.clientName,
    clientCompany: req.body.clientCompany || "",
    clientEmail: req.body.clientEmail || "",
    clientPhone: req.body.clientPhone || "",
    clientAddress: req.body.clientAddress || "",
    ...amounts,
    paidTo,
    status: req.body.status || "active",
    startDate: req.body.startDate || null,
    expectedEndDate: req.body.expectedEndDate || null,
    notes: req.body.notes || "",
    mouFile,
    documentationFile,
    createdBy: req.user.userId,
    updatedBy: req.user.userId
  });

  await audit({
    req,
    module: "projects",
    action: "CREATE",
    entityId: project._id,
    after: project.toObject()
  });

  return project;
};

exports.list = async (req) => {
  const query = {
    organizationId: req.user.organizationId
  };

  if (req.query.status && req.query.status !== "all") {
    query.status = req.query.status;
  }

  if (req.query.search) {
    const search = String(req.query.search).trim();
    query.$or = [
      { projectName: { $regex: search, $options: "i" } },
      { clientName: { $regex: search, $options: "i" } },
      { clientCompany: { $regex: search, $options: "i" } }
    ];
  }

  return Project.find(query)
    .populate("paidTo", "firstName lastName employeeCode")
    .sort({ createdAt: -1 })
    .lean();
};

exports.getById = async (req) => {
  const project = await Project.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  })
    .populate("paidTo", "firstName lastName employeeCode")
    .lean();

  if (!project) {
    throw { code: 404, message: "Project not found" };
  }

  return project;
};

exports.update = async (req) => {
  const project = await Project.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!project) {
    throw { code: 404, message: "Project not found" };
  }

  const before = project.toObject();

  if (req.body.projectName !== undefined) {
    const projectNameKey = toKey(req.body.projectName);
    const duplicate = await Project.findOne({
      _id: { $ne: project._id },
      organizationId: req.user.organizationId,
      projectNameKey
    }).select("_id");

    if (duplicate) {
      throw { code: 409, message: "Project name already exists" };
    }

    project.projectName = req.body.projectName;
    project.projectNameKey = projectNameKey;
  }

  const nextAmounts = computeAmounts({
    actualAmount:
      req.body.actualAmount !== undefined ? req.body.actualAmount : project.actualAmount,
    discountedAmount:
      req.body.discountedAmount !== undefined
        ? req.body.discountedAmount
        : project.discountedAmount,
    paidAmount: req.body.paidAmount !== undefined ? req.body.paidAmount : project.paidAmount
  });

  project.actualAmount = nextAmounts.actualAmount;
  project.discountedAmount = nextAmounts.discountedAmount;
  project.paidAmount = nextAmounts.paidAmount;
  project.pendingAmount = nextAmounts.pendingAmount;
  const paidToCandidate =
    req.body.paidTo !== undefined
      ? (req.body.paidTo || null)
      : project.paidTo || null;
  project.paidTo = await resolvePaidTo({
    organizationId: req.user.organizationId,
    paidTo: paidToCandidate
  });

  if (req.body.logoUrl !== undefined) project.logoUrl = req.body.logoUrl || "";
  if (req.body.clientName !== undefined) project.clientName = req.body.clientName;
  if (req.body.clientCompany !== undefined) project.clientCompany = req.body.clientCompany;
  if (req.body.clientEmail !== undefined) project.clientEmail = req.body.clientEmail || "";
  if (req.body.clientPhone !== undefined) project.clientPhone = req.body.clientPhone || "";
  if (req.body.clientAddress !== undefined) project.clientAddress = req.body.clientAddress || "";
  if (req.body.status !== undefined) project.status = req.body.status;
  if (req.body.startDate !== undefined) project.startDate = req.body.startDate || null;
  if (req.body.expectedEndDate !== undefined) {
    project.expectedEndDate = req.body.expectedEndDate || null;
  }
  if (req.body.notes !== undefined) project.notes = req.body.notes || "";
  if (req.body.mouUpload) {
    const mouFile = await uploadProjectFile(
      req.body.mouUpload,
      "hrms/project-mou-files",
      "project-mou"
    );
    if (mouFile) project.mouFile = mouFile;
  }
  if (req.body.documentationUpload) {
    const documentationFile = await uploadProjectFile(
      req.body.documentationUpload,
      "hrms/project-documentation-files",
      "project-documentation"
    );
    if (documentationFile) project.documentationFile = documentationFile;
  }

  project.updatedBy = req.user.userId;
  await project.save();

  await audit({
    req,
    module: "projects",
    action: "UPDATE",
    entityId: project._id,
    before,
    after: project.toObject()
  });

  return project;
};

exports.listEmployees = async (req) => {
  return Employee.find({
    organizationId: req.user.organizationId,
    status: "active"
  })
    .select("_id firstName lastName employeeCode")
    .sort({ firstName: 1, lastName: 1 })
    .lean();
};

exports.remove = async (req) => {
  const project = await Project.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId
  });
  if (!project) {
    throw { code: 404, message: "Project not found" };
  }

  const before = project.toObject();
  project.isDeleted = true;
  project.deletedAt = new Date();
  project.deletedBy = req.user.userId;
  project.updatedBy = req.user.userId;
  await project.save();

  await audit({
    req,
    module: "projects",
    action: "DELETE",
    entityId: project._id,
    before,
    after: project.toObject()
  });
};
