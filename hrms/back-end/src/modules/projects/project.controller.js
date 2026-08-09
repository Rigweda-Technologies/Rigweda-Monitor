const projectService = require("./project.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.create = async (req, res) => {
  const data = await projectService.create(req);
  return res.status(201).json(
    buildSuccessResponse({
      message: "Project created successfully",
      data
    })
  );
};

exports.list = async (req, res) => {
  const data = await projectService.list(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Projects fetched successfully",
      data
    })
  );
};

exports.getById = async (req, res) => {
  const data = await projectService.getById(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Project fetched successfully",
      data
    })
  );
};

exports.update = async (req, res) => {
  const data = await projectService.update(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Project updated successfully",
      data
    })
  );
};

exports.listEmployees = async (req, res) => {
  const data = await projectService.listEmployees(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Employees fetched successfully",
      data
    })
  );
};

exports.remove = async (req, res) => {
  await projectService.remove(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Project deleted successfully"
    })
  );
};
