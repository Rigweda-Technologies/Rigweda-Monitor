const service = require("./designation.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.create = async (req, res) => {
  try {
    const data = await service.create(req);
    res.status(201).json(buildSuccessResponse({ message: "Designation created", data }));
  } catch (error) {
    return res.status(error.code || 500).json({
      message: error.message || "Internal Server Error",
      data: null,
      error: error?.errorResponse?.errmsg || error.message || "Something went wrong"
    });
  }
};

exports.update = async (req, res) => {
  try {
    const data = await service.update(req);
    res.json(buildSuccessResponse({ message: "Designation updated", data }));
  } catch (error) {
    return res.status(error.code || 500).json({
      message: error.message || "Internal Server Error",
      data: null,
      error: error?.errorResponse?.errmsg || error.message || "Something went wrong"
    });
  }
};

exports.remove = async (req, res) => {
  try {
    await service.remove(req);
    res.json(buildSuccessResponse({ message: "Designation deleted" }));
  } catch (error) {
    return res.status(error.code || 500).json({
      message: error.message || "Internal Server Error",
      data: null,
      error: error?.errorResponse?.errmsg || error.message || "Something went wrong"
    });
  }
};

exports.list = async (req, res) => {
  try {    
    const data = await service.list(req);
    res.json(buildSuccessResponse({ message: "Designations fetched", data }));
  } catch (error) {
    return res.status(error.code || 500).json({
      message: error.message || "Internal Server Error",
      data: null,
      error: error?.errorResponse?.errmsg || error.message || "Something went wrong"
    });
  }
};
