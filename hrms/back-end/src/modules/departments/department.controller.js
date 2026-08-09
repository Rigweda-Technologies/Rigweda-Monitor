const departmentService = require("./department.service");
const {
  buildSuccessResponse,
  buildFailureResponse
} = require("../../utils/responseBuilder");
const {
  withCache,
  buildRequestCacheKey,
  invalidateCacheNamespace
} = require("../../utils/cache");

const DEPT_NAMESPACE = "departments";

exports.create = async (req, res) => {
  try {
    const data = await departmentService.create(req);
    await invalidateCacheNamespace(DEPT_NAMESPACE);
    res.status(201).json(
      buildSuccessResponse({
        code: 201,
        message: "Department created successfully",
        data
      })
    );
  } catch (error) {
    res.status(error?.code || 500).json(
      buildFailureResponse({
        code: error?.code || 500,
        message: error?.message || "Error creating department",
        error
      })
    );
  }
};

exports.update = async (req, res) => {
  const data = await departmentService.update(req);
  await invalidateCacheNamespace(DEPT_NAMESPACE);
  res.json(
    buildSuccessResponse({
      message: "Department updated successfully",
      data
    })
  );
};

exports.getById = async (req, res) => {
  const data = await departmentService.getById(req);
  res.json(
    buildSuccessResponse({
      message: "Department fetched successfully",
      data
    })
  );
};

exports.remove = async (req, res) => {
  await departmentService.remove(req);
  await invalidateCacheNamespace(DEPT_NAMESPACE);
  res.json(
    buildSuccessResponse({
      message: "Department deleted successfully"
    })
  );
};

exports.list = async (req, res) => {
  const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
  const data = includeInactive
    ? await departmentService.list(req)
    : await withCache({
        namespace: DEPT_NAMESPACE,
        key: buildRequestCacheKey(req, { version: "v2" }),
        ttlSeconds: Number(process.env.CACHE_TTL_DEPARTMENTS || 300),
        producer: () => departmentService.list(req)
      });
  res.json(
    buildSuccessResponse({
      message: "Departments fetched successfully",
      data
    })
  );
};
