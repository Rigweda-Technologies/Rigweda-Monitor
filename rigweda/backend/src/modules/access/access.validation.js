const Joi=require("joi");
const strongPassword=Joi.string().min(12).max(128).pattern(/[a-z]/).pattern(/[A-Z]/).pattern(/[0-9]/).pattern(/[^A-Za-z0-9]/).required();
const envelope=(body,params={},query={})=>Joi.object({body,params:Joi.object(params),query:Joi.object(query)});
const listUsersSchema=envelope(Joi.object(),{}, {page:Joi.number().integer().min(1).default(1),pageSize:Joi.number().integer().min(1).max(100).default(20),search:Joi.string().trim().max(100).allow("").default(""),status:Joi.string().valid("active","inactive","all").default("all")});
const createUserSchema=envelope(Joi.object({email:Joi.string().trim().lowercase().email().required(),displayName:Joi.string().trim().min(2).max(160).required(),initialPassword:strongPassword,roleId:Joi.string().uuid().required()}).required());
const updateUserSchema=envelope(Joi.object({displayName:Joi.string().trim().min(2).max(160),membershipStatus:Joi.string().valid("active","inactive"),roleId:Joi.string().uuid()}).min(1).required(),{userId:Joi.string().uuid().required()});
const createRoleSchema=envelope(Joi.object({name:Joi.string().trim().min(2).max(120).required(),description:Joi.string().trim().max(300).allow("",null),permissionKeys:Joi.array().items(Joi.string().max(100)).unique().default([])}).required());
const updateRoleSchema=envelope(Joi.object({name:Joi.string().trim().min(2).max(120),description:Joi.string().trim().max(300).allow("",null),permissionKeys:Joi.array().items(Joi.string().max(100)).unique()}).min(1).required(),{roleId:Joi.string().uuid().required()});
module.exports={listUsersSchema,createUserSchema,updateUserSchema,createRoleSchema,updateRoleSchema};
