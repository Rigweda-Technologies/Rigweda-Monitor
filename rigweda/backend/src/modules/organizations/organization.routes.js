const express = require("express");
const { asyncHandler } = require("../../middleware/async-handler");
const { validate } = require("../../middleware/validate");
const schemas = require("./organization.validation");

const createOrganizationRouter = (service) => {
  const router = express.Router();
  router.get("/", validate(schemas.listOrganizationsSchema), asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.list(req.validated.query), requestId: req.id });
  }));
  router.post("/", validate(schemas.createOrganizationSchema), asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await service.create(req.validated.body), requestId: req.id });
  }));
  router.get("/:organizationId", validate(schemas.getOrganizationSchema), asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.get(req.validated.params.organizationId), requestId: req.id });
  }));
  router.patch("/:organizationId", validate(schemas.updateOrganizationSchema), asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.update(req.validated.params.organizationId, req.validated.body), requestId: req.id });
  }));
  return router;
};

module.exports = { createOrganizationRouter };
