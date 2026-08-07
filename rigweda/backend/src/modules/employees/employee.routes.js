const express = require("express");
const {asyncHandler} = require("../../middleware/async-handler");
const {validate} = require("../../middleware/validate");
const schemas = require("./employee.validation");

const createEmployeeRouter = (service, permissions) => {
  const router = express.Router();

  router.get("/", validate(schemas.listEmployeesSchema), asyncHandler(async (req, res) => {
    res.json({success: true, data: await service.list(req.auth.organizationId, {...req.validated.query,includeArchived:false}), requestId: req.id});
  }));
  router.get("/summary", asyncHandler(async (req, res) => {
    res.json({success: true, data: await service.summary(req.auth.organizationId), requestId: req.id});
  }));
  router.get("/metadata", asyncHandler(async (req, res) => {
    res.json({success: true, data: await service.metadata(req.auth.organizationId), requestId: req.id});
  }));
  router.get("/next-number", permissions.manageEmployees, asyncHandler(async (req,res)=>{
    res.json({success:true,data:await service.nextEmployeeNumber(req.auth.organizationId),requestId:req.id});
  }));
  router.get("/upcoming-events",validate(schemas.upcomingEventsSchema),asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.upcomingEvents(req.auth.organizationId,req.validated.query.days),requestId:req.id});
  }));
  router.get("/organization-tree",asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.organizationTree(req.auth.organizationId),requestId:req.id});
  }));
  router.get("/archived",permissions.manageEmployees,validate(schemas.listEmployeesSchema),asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.list(req.auth.organizationId,{...req.validated.query,includeArchived:true,onlyArchived:true}),requestId:req.id});
  }));
  router.get("/me",permissions.selfReadEmployees,asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.myProfile(req.auth.organizationId,req.auth.userId),requestId:req.id});
  }));
  router.put("/me/profile",permissions.selfEditEmployees,validate(schemas.selfProfileSchema),asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.completeMyProfile(req.auth.organizationId,req.auth.userId,req.validated.body),requestId:req.id});
  }));
  router.get("/export", permissions.exportEmployees, validate(schemas.exportEmployeesSchema), asyncHandler(async (req, res) => {
    const csv = await service.exportCsv(req.auth.organizationId, req.validated.query);
    res.set({"Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="employees-${new Date().toISOString().slice(0,10)}.csv"`});
    res.send(`\uFEFF${csv}`);
  }));
  router.post("/", permissions.manageEmployees, validate(schemas.createEmployeeSchema), asyncHandler(async (req, res) => {
    res.status(201).json({success: true, data: await service.create(req.auth.organizationId, req.validated.body, req.auth.userId), requestId: req.id});
  }));
  router.put("/bulk-update",permissions.bulkEmployees,validate(schemas.bulkUpdateEmployeesSchema),asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.bulkUpdate(req.auth.organizationId,req.validated.body,req.auth.userId),requestId:req.id});
  }));
  router.get("/:employeeId/history", permissions.sensitiveEmployees, validate(schemas.employeeIdSchema), asyncHandler(async (req, res) => {
    res.json({success: true, data: await service.history(req.auth.organizationId, req.validated.params.employeeId), requestId: req.id});
  }));
  router.get("/:employeeId", permissions.sensitiveEmployees, validate(schemas.employeeIdSchema), asyncHandler(async (req, res) => {
    res.json({success: true, data: await service.get(req.auth.organizationId, req.validated.params.employeeId), requestId: req.id});
  }));
  router.patch("/:employeeId", permissions.manageEmployees, validate(schemas.updateEmployeeSchema), asyncHandler(async (req, res) => {
    res.json({success: true, data: await service.update(req.auth.organizationId, req.validated.params.employeeId, req.validated.body, req.auth.userId), requestId: req.id});
  }));
  router.put("/:employeeId/sensitive-records",permissions.documentEmployees,validate(schemas.sensitiveRecordsSchema),asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.updateSensitiveRecords(req.auth.organizationId,req.validated.params.employeeId,req.validated.body,req.auth.userId),requestId:req.id});
  }));
  router.post("/:employeeId/identifiers",permissions.documentEmployees,validate(schemas.addIdentifierSchema),asyncHandler(async(req,res)=>{
    res.status(201).json({success:true,data:await service.addIdentifier(req.auth.organizationId,req.validated.params.employeeId,req.validated.body,req.auth.userId),requestId:req.id});
  }));
  router.delete("/:employeeId/identifiers/:recordId",permissions.documentEmployees,validate(schemas.protectedRecordIdSchema),asyncHandler(async(req,res)=>{
    await service.removeIdentifier(req.auth.organizationId,req.validated.params.employeeId,req.validated.params.recordId,req.auth.userId);res.status(204).end();
  }));
  router.post("/:employeeId/documents",permissions.documentEmployees,validate(schemas.addDocumentSchema),asyncHandler(async(req,res)=>{
    res.status(201).json({success:true,data:await service.addDocument(req.auth.organizationId,req.validated.params.employeeId,req.validated.body,req.auth.userId),requestId:req.id});
  }));
  router.delete("/:employeeId/documents/:recordId",permissions.documentEmployees,validate(schemas.protectedRecordIdSchema),asyncHandler(async(req,res)=>{
    await service.removeDocument(req.auth.organizationId,req.validated.params.employeeId,req.validated.params.recordId,req.auth.userId);res.status(204).end();
  }));
  router.post("/:employeeId/status", permissions.lifecycleEmployees, validate(schemas.lifecycleSchema), asyncHandler(async (req, res) => {
    res.json({success: true, data: await service.changeStatus(req.auth.organizationId, req.validated.params.employeeId, req.validated.body, req.auth.userId), requestId: req.id});
  }));
  router.post("/:employeeId/archive",permissions.manageEmployees,validate(schemas.archiveEmployeeSchema),asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.archive(req.auth.organizationId,req.validated.params.employeeId,req.validated.body,req.auth.userId,false),requestId:req.id});
  }));
  router.post("/:employeeId/restore",permissions.manageEmployees,validate(schemas.archiveEmployeeSchema),asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.archive(req.auth.organizationId,req.validated.params.employeeId,req.validated.body,req.auth.userId,true),requestId:req.id});
  }));
  router.post("/:employeeId/reopen-profile",permissions.manageEmployees,validate(schemas.reopenProfileSchema),asyncHandler(async(req,res)=>{
    res.json({success:true,data:await service.reopenProfile(req.auth.organizationId,req.validated.params.employeeId,req.validated.body.version,req.auth.userId),requestId:req.id});
  }));

  return router;
};

module.exports = {createEmployeeRouter};
