const Joi=require("joi");

const uuid=Joi.string().uuid();
const date=Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom((value,helpers)=>{
  const parsed=new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==value?helpers.error("any.invalid"):value;
},"calendar date");
const version=Joi.number().integer().positive().required();
const envelope=(body=Joi.object(),params={},query={})=>Joi.object({body,params:Joi.object(params),query:Joi.object(query)});
const paging={page:Joi.number().integer().min(1).default(1),pageSize:Joi.number().integer().min(1).max(100).default(25),search:Joi.string().trim().max(120).allow("").default("")};
const requestStatuses=["draft","pending","approved","rejected","cancel_requested","cancelled","withdrawn","all"];

const metadataSchema=envelope(Joi.object(),{}, {search:paging.search});
const yearSchema=envelope(Joi.object(),{}, {year:Joi.number().integer().min(2000).max(2200).default(new Date().getUTCFullYear())});
const listRequestsSchema=envelope(Joi.object(),{}, {...paging,status:Joi.string().valid(...requestStatuses).default("all"),leaveTypeId:uuid.allow("",null),employeeId:uuid.allow("",null),dateFrom:date.allow("",null),dateTo:date.allow("",null)});
const requestSchema=envelope(Joi.object({leaveTypeId:uuid.required(),startDate:date.required(),endDate:date.required(),startSession:Joi.string().valid("full_day","first_half","second_half").default("full_day"),endSession:Joi.string().valid("full_day","first_half","second_half").default("full_day"),reason:Joi.string().trim().min(5).max(1000).required(),emergencyContact:Joi.string().trim().max(160).allow("",null),handoverEmployeeId:uuid.allow("",null),attachmentName:Joi.string().trim().max(255).allow("",null),attachmentUrl:Joi.string().uri({scheme:["https","http"]}).max(1000).allow("",null)}).required());
const actionSchema=envelope(Joi.object({version,reason:Joi.string().trim().min(3).max(1000).required()}).required(),{requestId:uuid.required()});
const reviewSchema=envelope(Joi.object({decision:Joi.string().valid("approved","rejected").required(),comment:Joi.string().trim().max(1000).allow("",null),version}).required(),{requestId:uuid.required()});
const requestIdSchema=envelope(Joi.object(),{requestId:uuid.required()});
const rangeSchema=envelope(Joi.object(),{}, {page:paging.page,pageSize:paging.pageSize,dateFrom:date.required(),dateTo:date.required(),search:paging.search,leaveTypeId:uuid.allow("",null),status:Joi.string().valid(...requestStatuses).default("all")});

const typeFields={code:Joi.string().trim().uppercase().pattern(/^[A-Z0-9][A-Z0-9_-]{1,31}$/),name:Joi.string().trim().min(2).max(120),description:Joi.string().trim().max(500).allow("",null),color:Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/),annualEntitlementDays:Joi.number().min(0).max(366),isPaid:Joi.boolean(),requiresApproval:Joi.boolean(),allowHalfDay:Joi.boolean(),allowNegativeBalance:Joi.boolean(),maximumNegativeDays:Joi.number().min(0).max(366),minimumNoticeDays:Joi.number().integer().min(0).max(365),maximumConsecutiveDays:Joi.number().integer().min(1).max(366).allow(null),attachmentRequiredAfterDays:Joi.number().min(.5).max(366).allow(null),carryForwardAllowed:Joi.boolean(),maximumCarryForwardDays:Joi.number().min(0).max(366),encashmentAllowed:Joi.boolean(),status:Joi.string().valid("active","inactive")};
const listTypesSchema=envelope(Joi.object(),{}, {...paging,status:Joi.string().valid("active","inactive","all").default("all")});
const createTypeSchema=envelope(Joi.object({...typeFields,code:typeFields.code.required(),name:typeFields.name.required(),annualEntitlementDays:typeFields.annualEntitlementDays.default(0),color:typeFields.color.default("#2f8f74"),isPaid:typeFields.isPaid.default(true),requiresApproval:typeFields.requiresApproval.default(true),allowHalfDay:typeFields.allowHalfDay.default(true),allowNegativeBalance:typeFields.allowNegativeBalance.default(false),maximumNegativeDays:typeFields.maximumNegativeDays.default(0),minimumNoticeDays:typeFields.minimumNoticeDays.default(0),carryForwardAllowed:typeFields.carryForwardAllowed.default(false),maximumCarryForwardDays:typeFields.maximumCarryForwardDays.default(0),encashmentAllowed:typeFields.encashmentAllowed.default(false),status:typeFields.status.default("active")}).required());
const updateTypeSchema=envelope(Joi.object({...typeFields,version}).min(2).required(),{typeId:uuid.required()});

const calendarFields={name:Joi.string().trim().min(2).max(120),description:Joi.string().trim().max(500).allow("",null),timezone:Joi.string().trim().min(3).max(80),isDefault:Joi.boolean(),status:Joi.string().valid("active","inactive"),locationIds:Joi.array().items(uuid).max(100).unique()};
const listCalendarsSchema=envelope(Joi.object(),{}, {...paging,status:Joi.string().valid("active","inactive","all").default("all")});
const createCalendarSchema=envelope(Joi.object({...calendarFields,name:calendarFields.name.required(),timezone:calendarFields.timezone.default("Asia/Kolkata"),isDefault:calendarFields.isDefault.default(false),status:calendarFields.status.default("active"),locationIds:calendarFields.locationIds.default([])}).required());
const updateCalendarSchema=envelope(Joi.object({...calendarFields,version}).min(2).required(),{calendarId:uuid.required()});
const listHolidaysSchema=envelope(Joi.object(),{}, {...paging,calendarId:uuid.allow("",null),dateFrom:date.allow("",null),dateTo:date.allow("",null)});
const holidayFields={calendarId:uuid,name:Joi.string().trim().min(2).max(160),holidayDate:date,isOptional:Joi.boolean(),description:Joi.string().trim().max(500).allow("",null)};
const createHolidaySchema=envelope(Joi.object({...holidayFields,calendarId:uuid.required(),name:holidayFields.name.required(),holidayDate:date.required(),isOptional:holidayFields.isOptional.default(false)}).required());
const updateHolidaySchema=envelope(Joi.object({name:holidayFields.name,holidayDate:holidayFields.holidayDate,isOptional:holidayFields.isOptional,description:holidayFields.description,version}).min(2).required(),{holidayId:uuid.required()});

const listBalancesSchema=envelope(Joi.object(),{}, {...paging,leaveTypeId:uuid.allow("",null),employeeId:uuid.allow("",null),year:Joi.number().integer().min(2000).max(2200).default(new Date().getUTCFullYear())});
const adjustmentSchema=envelope(Joi.object({employeeId:uuid.required(),leaveTypeId:uuid.required(),year:Joi.number().integer().min(2000).max(2200).required(),amountDays:Joi.number().min(-366).max(366).invalid(0).required(),reason:Joi.string().trim().min(5).max(500).required()}).required());
const entityIdSchema=envelope(Joi.object(),{typeId:uuid.required()});

module.exports={metadataSchema,yearSchema,listRequestsSchema,requestSchema,actionSchema,reviewSchema,requestIdSchema,rangeSchema,listTypesSchema,createTypeSchema,updateTypeSchema,listCalendarsSchema,createCalendarSchema,updateCalendarSchema,listHolidaysSchema,createHolidaySchema,updateHolidaySchema,listBalancesSchema,adjustmentSchema,entityIdSchema};
