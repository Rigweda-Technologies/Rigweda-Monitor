const express=require("express");
const {rateLimit}=require("express-rate-limit");
const {asyncHandler}=require("../../middleware/async-handler");
const {validate}=require("../../middleware/validate");
const schemas=require("./auth.validation");

const createAuthRouter=({service,authenticate,env})=>{
  const router=express.Router(); const cookieName="rigweda_refresh";
  const cookie=(expires)=>({httpOnly:true,secure:env.NODE_ENV==="production",sameSite:"lax",path:"/api/v1/auth",expires});
  const limiter=rateLimit({windowMs:15*60_000,limit:20,standardHeaders:"draft-8",legacyHeaders:false});
  router.post("/login",limiter,validate(schemas.loginSchema),asyncHandler(async(req,res)=>{const result=await service.login({...req.validated.body,userAgent:req.get("user-agent"),ipAddress:req.ip});res.cookie(cookieName,result.refreshToken,cookie(result.refreshExpiresAt));res.json({success:true,data:{user:result.user,accessToken:result.accessToken},requestId:req.id});}));
  router.post("/refresh",limiter,asyncHandler(async(req,res)=>{const result=await service.refresh(req.cookies[cookieName]);res.cookie(cookieName,result.refreshToken,cookie(result.refreshExpiresAt));res.json({success:true,data:{user:result.user,accessToken:result.accessToken},requestId:req.id});}));
  router.post("/logout",asyncHandler(async(req,res)=>{await service.logout(req.cookies[cookieName]);res.clearCookie(cookieName,{...cookie(new Date(0)),expires:undefined});res.status(204).end();}));
  router.get("/me",authenticate,asyncHandler(async(req,res)=>res.json({success:true,data:await service.me(req.auth.userId),requestId:req.id})));
  router.post("/change-password",authenticate,validate(schemas.changePasswordSchema),asyncHandler(async(req,res)=>{await service.changePassword(req.auth.userId,req.auth.sessionId,req.validated.body.currentPassword,req.validated.body.newPassword);res.status(204).end();}));
  router.post("/forgot-password",limiter,validate(schemas.forgotPasswordSchema),asyncHandler(async(req,res)=>{const token=await service.requestPasswordReset(req.validated.body.email,req.ip,req.get("user-agent"));res.json({success:true,data:{message:"If the account exists, reset instructions have been prepared.",...(env.NODE_ENV==="development"&&token?{developmentResetToken:token}:{})}});}));
  router.post("/reset-password",limiter,validate(schemas.resetPasswordSchema),asyncHandler(async(req,res)=>{await service.resetPassword(req.validated.body.token,req.validated.body.newPassword,req.ip,req.get("user-agent"));res.status(204).end();}));
  router.get("/sessions",authenticate,asyncHandler(async(req,res)=>res.json({success:true,data:await service.listSessions(req.auth.userId,req.auth.sessionId)})));
  router.delete("/sessions/:sessionId",authenticate,validate(schemas.sessionSchema),asyncHandler(async(req,res)=>{await service.revokeSession(req.auth.userId,req.auth.sessionId,req.validated.params.sessionId);res.status(204).end();}));
  router.delete("/sessions",authenticate,asyncHandler(async(req,res)=>res.json({success:true,data:{revoked:await service.revokeOtherSessions(req.auth.userId,req.auth.sessionId)}})));
  router.get("/preferences",authenticate,asyncHandler(async(req,res)=>res.json({success:true,data:await service.getPreferences(req.auth.userId)})));
  router.patch("/preferences",authenticate,validate(schemas.preferencesSchema),asyncHandler(async(req,res)=>res.json({success:true,data:await service.updatePreferences(req.auth.userId,req.validated.body)})));
  return router;
};
module.exports={createAuthRouter};
