const router = require("express").Router();
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const asyncHandler = require("../../middlewares/asyncHandler");

const controller = require("./project.controller");
const {
  createProjectSchema,
  updateProjectSchema,
  listProjectsQuerySchema
} = require("./project.validation");

router.post(
  "/",
  auth,
  authorize("PROJECT_MANAGE"),
  validate(createProjectSchema),
  asyncHandler(controller.create)
);

router.get(
  "/",
  auth,
  authorize(["PROJECT_VIEW", "PROJECT_MANAGE"]),
  validate(listProjectsQuerySchema, "query"),
  asyncHandler(controller.list)
);

router.get(
  "/employees",
  auth,
  authorize(["PROJECT_VIEW", "PROJECT_MANAGE"]),
  asyncHandler(controller.listEmployees)
);

router.get(
  "/:id",
  auth,
  authorize(["PROJECT_VIEW", "PROJECT_MANAGE"]),
  asyncHandler(controller.getById)
);

router.put(
  "/:id",
  auth,
  authorize("PROJECT_MANAGE"),
  validate(updateProjectSchema),
  asyncHandler(controller.update)
);

router.delete(
  "/:id",
  auth,
  authorize("PROJECT_MANAGE"),
  asyncHandler(controller.remove)
);

module.exports = router;
