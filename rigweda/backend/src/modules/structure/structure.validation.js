const Joi=require("joi");

const uuid=Joi.string().uuid();
const nullableUuid=uuid.allow(null,"");
const code=Joi.string().trim().uppercase().pattern(/^[A-Z0-9][A-Z0-9_-]{1,31}$/);
const name=Joi.string().trim().min(2).max(120);
const text=(max)=>Joi.string().trim().max(max).allow("",null);
const status=Joi.string().valid("active","inactive");
const version=Joi.number().integer().positive();
const envelope=(body,params={},query={})=>Joi.object({body,params:Joi.object(params),query:Joi.object(query)});
const listQuery={page:Joi.number().integer().min(1).default(1),pageSize:Joi.number().integer().min(1).max(100).default(50),search:Joi.string().trim().max(100).allow("").default(""),status:Joi.string().valid("active","inactive","all").default("all")};
const listSchema=envelope(Joi.object(),{},listQuery);
const idSchema=envelope(Joi.object(),{entityId:uuid.required()});

const departmentFields={code,name,description:text(500),parentDepartmentId:nullableUuid,headEmployeeId:nullableUuid,costCenter:text(80),status};
const jobTitleFields={code,name,description:text(500),jobLevel:text(60),grade:text(40),careerTrack:Joi.string().valid("individual","management","executive","support").allow(null,""),status};
const address=Joi.object({line1:text(200),line2:text(200),city:text(100),state:text(100),postalCode:text(20),country:Joi.string().trim().uppercase().length(2).default("IN")}).default({country:"IN"});
const locationFields={code,name,description:text(500),locationType:Joi.string().valid("office","branch","client_site","remote","other"),timezone:Joi.string().trim().min(3).max(64),address,email:Joi.string().trim().lowercase().email().max(254).allow("",null),phone:Joi.string().trim().pattern(/^\+?[0-9 ()-]{7,32}$/).allow("",null),capacity:Joi.number().integer().min(0).allow(null),status};

const createDepartmentSchema=envelope(Joi.object({...departmentFields,code:code.required(),name:name.required(),status:status.default("active")}).required());
const updateDepartmentSchema=envelope(Joi.object({...departmentFields,version:version.required()}).min(2).required(),{entityId:uuid.required()});
const createJobTitleSchema=envelope(Joi.object({...jobTitleFields,code:code.required(),name:name.required(),status:status.default("active")}).required());
const updateJobTitleSchema=envelope(Joi.object({...jobTitleFields,version:version.required()}).min(2).required(),{entityId:uuid.required()});
const createLocationSchema=envelope(Joi.object({...locationFields,code:code.required(),name:name.required(),locationType:locationFields.locationType.default("office"),timezone:locationFields.timezone.default("Asia/Kolkata"),status:status.default("active")}).required());
const updateLocationSchema=envelope(Joi.object({...locationFields,version:version.required()}).min(2).required(),{entityId:uuid.required()});

module.exports={listSchema,idSchema,createDepartmentSchema,updateDepartmentSchema,createJobTitleSchema,updateJobTitleSchema,createLocationSchema,updateLocationSchema};
