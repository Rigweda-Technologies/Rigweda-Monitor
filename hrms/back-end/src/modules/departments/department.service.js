const Department = require("./department.model");
const Employee = require("../employees/employee.model");
const OrganizationService = require("../organizations/organization.service");
const { audit } = require("../auditLogs/auditLogs.service");
const mongoose = require("mongoose");

const normalizeManagerId = (value) => {
  if (!value || !String(value).trim()) return undefined;
  return mongoose.Types.ObjectId.isValid(value) ? value : undefined;
};

exports.create = async (req) => {
  try {
    let { organizationId, managerId } = req.body;
    if (!organizationId) {
      organizationId = req.user.organizationId;
    }
    managerId = normalizeManagerId(managerId);

    if (!managerId) {
      const employee = await Employee.findOne({
        userId: req.user.userId,
        organizationId
      }).select("_id");
      if (employee) managerId = employee._id;
    }

    const exists = await Department.findOne({
      organizationId,
      code: req.body.code
    });

    if (exists) {
      throw { code: 400, message: "Department code already exists" };
    }

    const departmentPayload = {
      ...req.body,
      organizationId,
      managerId
    };

    if (!managerId) {
      delete departmentPayload.managerId;
    }

    const department = await Department.create(departmentPayload);

    await audit({
      req,
      module: "departments",
      action: "CREATE",
      entityId: department._id,
      before: null,
      after: department.toObject()
    });
    
    return department;
  } catch (error) {
    console.log(error);
    throw error;
  }
};

exports.update = async (req) => {
  const departmentId = mongoose.Types.ObjectId.isValid(req.params.id)
    ? new mongoose.Types.ObjectId(req.params.id)
    : req.params.id;
  const organizationId = mongoose.Types.ObjectId.isValid(req.user.organizationId)
    ? new mongoose.Types.ObjectId(req.user.organizationId)
    : req.user.organizationId;
  const filter = {
    _id: departmentId,
    organizationId
  };
  const before = await Department.collection.findOne(filter);

  if (!before) {
    throw { code: 404, message: "Department not found" };
  }

  const updateDoc = { ...req.body };
  const normalizedManagerId = normalizeManagerId(updateDoc.managerId);

  if (updateDoc.managerId !== undefined) {
    if (normalizedManagerId) {
      updateDoc.managerId = normalizedManagerId;
    } else {
      delete updateDoc.managerId;
    }
  }

  if (updateDoc.status === "active") {
    updateDoc.isDeleted = false;
    updateDoc.deletedAt = null;
    updateDoc.deletedBy = null;
  }

  const updateOperation = { $set: updateDoc };
  if (req.body.managerId !== undefined && !normalizedManagerId) {
    updateOperation.$unset = { managerId: "" };
  }

  await Department.updateOne(filter, updateOperation);
  const department = await Department.collection.findOne(filter);

  await audit({
    req,
    module: "departments",
    action: "UPDATE",
    entityId: before._id,
    before,
    after: department
  });

  return department;
};

exports.remove = async (req) => {
  const department = await Department.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    isDeleted: false
  });

  if (!department) {
    throw { code: 404, message: "Department not found" };
  }

  if (department.status === "inactive") {
    return {
      alreadyInactive: true,
      department: department.toObject()
    };
  }

  const before = department.toObject();

  department.status = "inactive";
  await department.save();

  await audit({
    req,
    module: "departments",
    action: "DELETE",
    entityId: department._id,
    before,
    after: department.toObject()
  });

  return {
    alreadyInactive: false,
    department: department.toObject()
  };
};

exports.getById = async (req) => {
  const departmentId = mongoose.Types.ObjectId.isValid(req.params.id)
    ? new mongoose.Types.ObjectId(req.params.id)
    : req.params.id;
  const organizationId = mongoose.Types.ObjectId.isValid(req.user.organizationId)
    ? new mongoose.Types.ObjectId(req.user.organizationId)
    : req.user.organizationId;

  const department = await Department.collection.findOne({
    _id: departmentId,
    organizationId
  });

  if (!department) {
    throw { code: 404, message: "Department not found" };
  }

  return {
    ...department,
    status: department.isDeleted ? "inactive" : department.status
  };
};

exports.list = async (req) => {
  const isSuperAdmin = await OrganizationService.isUserSuperAdmin(req.user.userId);
  const requestedOrgId = req.query.organizationId;
  const organizationId = isSuperAdmin && requestedOrgId ? requestedOrgId : req.user.organizationId;
  const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
  const organizationObjectId = mongoose.Types.ObjectId.isValid(organizationId)
    ? new mongoose.Types.ObjectId(organizationId)
    : organizationId;
  const match = {
    organizationId: organizationObjectId
  };

  if (!includeInactive) {
    match.isDeleted = false;
    match.status = "active";
  }

  const departments = await Department.aggregate([
    { $match: match },
    {
      $addFields: {
        status: {
          $cond: [{ $eq: ["$isDeleted", true] }, "inactive", "$status"]
        }
      }
    },
    {
      $sort: {
        status: 1,
        name: 1
      }
    }
  ]);

  return departments;
};
