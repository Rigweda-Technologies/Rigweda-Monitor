const roleService = require("./role.service");
const { buildSuccessResponse } = require("../../utils/responseBuilder");

exports.create = async (req, res) => {
  const data = await roleService.create({
    ...req.body,
    organizationId: req.user.organizationId
  });

  res.status(201).json(
    buildSuccessResponse({
      code: 201,
      message: "Role created successfully",
      data
    })
  );
};

exports.update = async (req, res) => {
  const data = await roleService.update(req.params.id, req.body);

  res.json(
    buildSuccessResponse({
      message: "Role updated successfully",
      data
    })
  );
};

exports.remove = async (req, res) => {
  await roleService.remove(req.params.id);

  res.json(
    buildSuccessResponse({
      message: "Role deactivated successfully"
    })
  );
};

exports.list = async (req, res) => {
  const data = await roleService.list(req.user.organizationId);

  res.json(
    buildSuccessResponse({
      data
    })
  );
};

exports.getById = async (req, res) => {
  const data = await roleService.getById(req.params.id);

  res.json(
    buildSuccessResponse({
      data
    })
  );
};
