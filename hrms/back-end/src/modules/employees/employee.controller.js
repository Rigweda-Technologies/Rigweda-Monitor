const service = require("./employee.service");
const { getEmployeeleaves } = require("../leaveTypes/leaveType.service")
const { buildSuccessResponse } = require("../../utils/responseBuilder");

/**
 * HR / Admin creates employee
 */
exports.createByHr = async (req, res) => {
  const data = await service.createByHr(req);

  res.status(201).json(
    buildSuccessResponse({
      message: "Employee created and onboarding email sent",
      data
    })
  );
};

/**
 * Employee completes profile (first login)
 */
exports.completeMyProfile = async (req, res) => {
  const data = await service.completeMyProfile(req);

  res.json(
    buildSuccessResponse({
      message: "Profile completed successfully",
      data
    })
  );
};

exports.listByOrganization = async (req, res) => {
  const data = await service.listByOrganization(req);

  res.json(
    buildSuccessResponse({
      message: "Employees fetched successfully",
      data
    })
  );
};

exports.exportCsv = async (req, res) => {
  await service.exportCsv(req, res);
};

exports.getNextEmployeeCode = async (req, res) => {
  const data = await service.getNextEmployeeCode(req);

  res.json(
    buildSuccessResponse({
      message: "Next employee code fetched successfully",
      data
    })
  );
};

exports.getEmployeeleaves = async (req, res) => {
  const data = await getEmployeeleaves(req);
  return res.status(200).json(buildSuccessResponse({ data }));
}

exports.upcomingEvents = async (req, res) => {
  const data = await service.getUpcomingEvents(req);
  return res.status(200).json(
    buildSuccessResponse({
      message: "Upcoming events fetched successfully",
      data
    })
  );
};

exports.getById = async (req, res) => {
  const data = await service.getById(req);

  res.json(
    buildSuccessResponse({
      message: "Employee fetched successfully",
      data
    })
  );
};

exports.getMe = async (req, res) => {
  const data = await service.getMe(req);

  res.json(
    buildSuccessResponse({
      message: "Profile fetched successfully",
      data
    })
  );
};

exports.updateByHr = async (req, res) => {
  const data = await service.updateByHr(req);

  res.json(
    buildSuccessResponse({
      message: "Employee updated successfully",
      data
    })
  );
};

exports.lifecycleAction = async (req, res) => {
  const data = await service.lifecycleAction(req);

  res.json(
    buildSuccessResponse({
      message: "Employee lifecycle updated successfully",
      data
    })
  );
};

exports.reopenProfileCompletion = async (req, res) => {
  const data = await service.reopenProfileCompletion(req);

  res.json(
    buildSuccessResponse({
      message: "Employee profile form re-enabled successfully",
      data
    })
  );
};

exports.bulkUpdate = async (req, res) => {
  const data = await service.bulkUpdate(req);

  res.json(
    buildSuccessResponse({
      message: "Employees updated successfully",
      data
    })
  );
};

exports.remove = async (req, res) => {
  await service.remove(req);

  res.json(
    buildSuccessResponse({
      message: "Employee deleted successfully"
    })
  );
};
