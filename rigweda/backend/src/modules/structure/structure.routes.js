const express=require("express");
const {asyncHandler}=require("../../middleware/async-handler");
const {validate}=require("../../middleware/validate");
const schemas=require("./structure.validation");

const createStructureRouter=(service,manage)=>{
  const router=express.Router();
  router.get("/summary",asyncHandler(async(req,res)=>res.json({success:true,data:await service.summary(req.auth.organizationId),requestId:req.id})));
  router.get("/metadata",asyncHandler(async(req,res)=>res.json({success:true,data:await service.metadata(req.auth.organizationId),requestId:req.id})));
  router.get("/departments/tree",asyncHandler(async(req,res)=>res.json({success:true,data:await service.departmentTree(req.auth.organizationId),requestId:req.id})));
  const register=(path,kind,createSchema,updateSchema,listMethod)=>{
    router.get(path,validate(schemas.listSchema),asyncHandler(async(req,res)=>res.json({success:true,data:await service[listMethod](req.auth.organizationId,req.validated.query),requestId:req.id})));
    router.post(path,manage,validate(createSchema),asyncHandler(async(req,res)=>res.status(201).json({success:true,data:await service.create(kind,req.auth.organizationId,req.validated.body,req.auth.userId),requestId:req.id})));
    router.get(`${path}/:entityId/history`,validate(schemas.idSchema),asyncHandler(async(req,res)=>res.json({success:true,data:await service.history(kind,req.auth.organizationId,req.validated.params.entityId),requestId:req.id})));
    router.get(`${path}/:entityId`,validate(schemas.idSchema),asyncHandler(async(req,res)=>res.json({success:true,data:await service.get(kind,req.auth.organizationId,req.validated.params.entityId),requestId:req.id})));
    router.patch(`${path}/:entityId`,manage,validate(updateSchema),asyncHandler(async(req,res)=>res.json({success:true,data:await service.update(kind,req.auth.organizationId,req.validated.params.entityId,req.validated.body,req.auth.userId),requestId:req.id})));
  };
  register("/departments","department",schemas.createDepartmentSchema,schemas.updateDepartmentSchema,"listDepartments");
  register("/job-titles","job_title",schemas.createJobTitleSchema,schemas.updateJobTitleSchema,"listJobTitles");
  register("/work-locations","work_location",schemas.createLocationSchema,schemas.updateLocationSchema,"listLocations");
  return router;
};

module.exports={createStructureRouter};
