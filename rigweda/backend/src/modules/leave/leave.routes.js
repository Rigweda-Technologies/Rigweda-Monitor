const express=require("express");
const {asyncHandler}=require("../../middleware/async-handler");
const {validate}=require("../../middleware/validate");
const schemas=require("./leave.validation");

const createLeaveRouter=(service,permissions)=>{
  const router=express.Router();
  const success=(req,res,data,status=200)=>res.status(status).json({success:true,data,requestId:req.id});

  router.get("/metadata",validate(schemas.metadataSchema),asyncHandler(async(req,res)=>success(req,res,await service.metadata(req.auth.organizationId,req.auth.userId,req.validated.query.search))));
  router.get("/me/summary",validate(schemas.yearSchema),asyncHandler(async(req,res)=>success(req,res,await service.mySummary(req.auth.organizationId,req.auth.userId,req.validated.query.year))));
  router.get("/me/balances",validate(schemas.yearSchema),asyncHandler(async(req,res)=>success(req,res,await service.myBalances(req.auth.organizationId,req.auth.userId,req.validated.query.year))));
  router.get("/me/requests",validate(schemas.listRequestsSchema),asyncHandler(async(req,res)=>success(req,res,await service.myRequests(req.auth.organizationId,req.auth.userId,req.validated.query))));
  router.post("/me/requests",permissions.self,validate(schemas.requestSchema),asyncHandler(async(req,res)=>success(req,res,await service.createRequest(req.auth.organizationId,req.auth.userId,req.validated.body),201)));
  router.post("/me/requests/:requestId/cancel",permissions.self,validate(schemas.actionSchema),asyncHandler(async(req,res)=>success(req,res,await service.cancel(req.auth.organizationId,req.auth.userId,req.validated.params.requestId,req.validated.body))));

  router.get("/team-calendar",validate(schemas.rangeSchema),asyncHandler(async(req,res)=>success(req,res,await service.teamCalendar(req.auth.organizationId,req.validated.query))));
  router.get("/requests/report",permissions.approve,validate(schemas.rangeSchema),asyncHandler(async(req,res)=>success(req,res,await service.reportSummary(req.auth.organizationId,req.validated.query))));
  router.get("/requests/export",permissions.export,validate(schemas.rangeSchema),asyncHandler(async(req,res)=>{const csv=await service.export(req.auth.organizationId,req.validated.query);res.set({"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="leave-${req.validated.query.dateFrom}-${req.validated.query.dateTo}.csv"`});res.send(`\uFEFF${csv}`);}));
  router.get("/requests",permissions.approve,validate(schemas.listRequestsSchema),asyncHandler(async(req,res)=>success(req,res,await service.requests(req.auth.organizationId,req.validated.query))));
  router.get("/requests/:requestId",permissions.approve,validate(schemas.requestIdSchema),asyncHandler(async(req,res)=>success(req,res,await service.request(req.auth.organizationId,req.validated.params.requestId))));
  router.post("/requests/:requestId/review",permissions.approve,validate(schemas.reviewSchema),asyncHandler(async(req,res)=>success(req,res,await service.review(req.auth.organizationId,req.validated.params.requestId,req.validated.body,req.auth.userId))));
  router.post("/requests/:requestId/cancellation-review",permissions.approve,validate(schemas.reviewSchema),asyncHandler(async(req,res)=>success(req,res,await service.reviewCancellation(req.auth.organizationId,req.validated.params.requestId,req.validated.body,req.auth.userId))));

  router.get("/types",validate(schemas.listTypesSchema),asyncHandler(async(req,res)=>success(req,res,await service.types(req.auth.organizationId,req.validated.query))));
  router.get("/types/:typeId",validate(schemas.entityIdSchema),asyncHandler(async(req,res)=>success(req,res,await service.type(req.auth.organizationId,req.validated.params.typeId))));
  router.post("/types",permissions.configure,validate(schemas.createTypeSchema),asyncHandler(async(req,res)=>success(req,res,await service.createType(req.auth.organizationId,req.validated.body,req.auth.userId),201)));
  router.patch("/types/:typeId",permissions.configure,validate(schemas.updateTypeSchema),asyncHandler(async(req,res)=>success(req,res,await service.updateType(req.auth.organizationId,req.validated.params.typeId,req.validated.body,req.auth.userId))));

  router.get("/balances",permissions.configure,validate(schemas.listBalancesSchema),asyncHandler(async(req,res)=>success(req,res,await service.balances(req.auth.organizationId,req.validated.query))));
  router.post("/balances/adjust",permissions.configure,validate(schemas.adjustmentSchema),asyncHandler(async(req,res)=>success(req,res,await service.adjustBalance(req.auth.organizationId,req.validated.body,req.auth.userId))));
  router.get("/calendars",validate(schemas.listCalendarsSchema),asyncHandler(async(req,res)=>success(req,res,await service.calendars(req.auth.organizationId,req.validated.query))));
  router.post("/calendars",permissions.configure,validate(schemas.createCalendarSchema),asyncHandler(async(req,res)=>success(req,res,await service.createCalendar(req.auth.organizationId,req.validated.body,req.auth.userId),201)));
  router.patch("/calendars/:calendarId",permissions.configure,validate(schemas.updateCalendarSchema),asyncHandler(async(req,res)=>success(req,res,await service.updateCalendar(req.auth.organizationId,req.validated.params.calendarId,req.validated.body,req.auth.userId))));
  router.get("/holidays",validate(schemas.listHolidaysSchema),asyncHandler(async(req,res)=>success(req,res,await service.holidays(req.auth.organizationId,req.validated.query))));
  router.post("/holidays",permissions.configure,validate(schemas.createHolidaySchema),asyncHandler(async(req,res)=>success(req,res,await service.createHoliday(req.auth.organizationId,req.validated.body,req.auth.userId),201)));
  router.patch("/holidays/:holidayId",permissions.configure,validate(schemas.updateHolidaySchema),asyncHandler(async(req,res)=>success(req,res,await service.updateHoliday(req.auth.organizationId,req.validated.params.holidayId,req.validated.body,req.auth.userId))));
  return router;
};

module.exports={createLeaveRouter};
