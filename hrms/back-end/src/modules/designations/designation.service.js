const Designation = require("./designation.model");
const Department = require("../departments/department.model");
const { audit } = require("../auditLogs/auditLogs.service");
const mongoose = require("mongoose");

const ensureActiveDepartmentForDesignation = async ({
  organizationId,
  departmentId,
  nextStatus
}) => {
  if (nextStatus !== "active" || !departmentId) return;

  const normalizedDepartmentId = mongoose.Types.ObjectId.isValid(departmentId)
    ? new mongoose.Types.ObjectId(departmentId)
    : departmentId;
  const normalizedOrganizationId = mongoose.Types.ObjectId.isValid(organizationId)
    ? new mongoose.Types.ObjectId(organizationId)
    : organizationId;

  const department = await Department.collection.findOne({
    _id: normalizedDepartmentId,
    organizationId: normalizedOrganizationId
  });

  if (!department || department.isDeleted || department.status !== "active") {
    throw {
      code: 400,
      message:
        "Selected department is inactive. Please choose a different active department or reactivate the department first."
    };
  }
};

exports.create = async (req) => {
  try {
  await ensureActiveDepartmentForDesignation({
    organizationId: req.user.organizationId,
    departmentId: req.body.departmentId,
    nextStatus: req.body.status || "active"
  });
  const designation = await Designation.create({
    ...req.body,
    organizationId: req.user.organizationId
  });

  await audit({
    req,
    module: "designations",
    action: "CREATE",
    entityId: designation._id,
    after: designation.toObject()
  });

  return designation;
  } catch (error) {
    throw error;
  }
};

exports.update = async (req) => {
  const designationId = mongoose.Types.ObjectId.isValid(req.params.id)
    ? new mongoose.Types.ObjectId(req.params.id)
    : req.params.id;
  const organizationId = mongoose.Types.ObjectId.isValid(req.user.organizationId)
    ? new mongoose.Types.ObjectId(req.user.organizationId)
    : req.user.organizationId;
  const filter = {
    _id: designationId,
    organizationId
  };
  const before = await Designation.collection.findOne(filter);

  if (!before) {
    throw { code: 404, message: "Designation not found" };
  }

  const updateDoc = { ...req.body };
  await ensureActiveDepartmentForDesignation({
    organizationId,
    departmentId: updateDoc.departmentId || before.departmentId,
    nextStatus: updateDoc.status || before.status
  });
  if (updateDoc.status === "active") {
    updateDoc.isDeleted = false;
    updateDoc.deletedAt = null;
    updateDoc.deletedBy = null;
  }

  await Designation.updateOne(filter, { $set: updateDoc });
  const [designation] = await Designation.aggregate([
    {
      $match: {
        _id: designationId,
        organizationId
      }
    },
    {
      $lookup: {
        from: "departments",
        localField: "departmentId",
        foreignField: "_id",
        as: "departments"
      }
    },
    {
      $unwind: {
        path: "$departments",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $project: {
        _id: 1,
        organizationId: 1,
        name: 1,
        departmentId: 1,
        status: 1,
        isDeleted: 1,
        createdAt: 1,
        updatedAt: 1,
        departmentName: "$departments.name"
      }
    }
  ]);

  await audit({
    req,
    module: "designations",
    action: "UPDATE",
    entityId: before._id,
    before,
    after: designation
  });

  return designation;
};

exports.remove = async (req) => {
  const designation = await Designation.findOne({
    _id: req.params.id,
    organizationId: req.user.organizationId,
    isDeleted: false
  });

  if (!designation) {
    throw { code: 404, message: "Designation not found" };
  }

  if (designation.status === "inactive") {
    return {
      alreadyInactive: true,
      designation: designation.toObject()
    };
  }

  const before = designation.toObject();
  designation.status = "inactive";
  await designation.save();

  await audit({
    req,
    module: "designations",
    action: "DELETE",
    entityId: designation._id,
    before,
    after: designation.toObject()
  });

  return {
    alreadyInactive: false,
    designation: designation.toObject()
  };
};

exports.list = async (req) => {
  try{
    const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
    const matchStage = {
      organizationId: new mongoose.Types.ObjectId(req.user.organizationId)
    };

    if (req.query.departmentId && mongoose.Types.ObjectId.isValid(req.query.departmentId)) {
      matchStage.departmentId = new mongoose.Types.ObjectId(req.query.departmentId);
    }

    if (!includeInactive) {
      matchStage.isDeleted = false;
      matchStage.status = "active";
    }

    const results = await Designation.aggregate([
      { $match: matchStage },
      {
        $lookup: {
          from: 'departments',
          localField: 'departmentId',
          foreignField: '_id',
          as: 'departments'
        }
      },
      {
        $unwind: {
          path: '$departments',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 1,
          organizationId: 1,
          name: 1,
          departmentId: 1,
          status: {
            $cond: [{ $eq: ["$isDeleted", true] }, "inactive", "$status"]
          },
          isDeleted: 1,
          createdAt: 1,
          updatedAt: 1,
          departmentName: '$departments.name'
        }
      },
      {
        $sort: {
          status: 1,
          name: 1,
          departmentName: 1
        }
      }
    ]);
  
  return results;
} catch(err){
  throw err;
}
};
