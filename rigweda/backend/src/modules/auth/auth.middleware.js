const { AppError } = require("../../lib/app-error");

const createAuthenticate = (tokens) => (req,_res,next) => {
  const [scheme,token]=(req.headers.authorization||"").split(" ");
  if(scheme!=="Bearer"||!token) return next(new AppError(401,"AUTHENTICATION_REQUIRED","Sign in to continue."));
  try { const payload=tokens.verifyAccessToken(token); req.auth={userId:payload.sub,organizationId:payload.org,roleKey:payload.role,sessionId:payload.sid}; return next(); }
  catch { return next(new AppError(401,"INVALID_ACCESS_TOKEN","Your access token is invalid or expired.")); }
};
const requireRoles=(...roles)=>(req,_res,next)=>roles.includes(req.auth?.roleKey)?next():next(new AppError(403,"INSUFFICIENT_PERMISSION","You do not have permission to perform this action."));
const requirePermission=(pool,permission)=>(req,_res,next)=>pool.query(`SELECT 1 FROM organization_memberships m JOIN role_permissions rp ON rp.role_id=m.role_id WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active' AND rp.permission_key=$3`,[req.auth.userId,req.auth.organizationId,permission]).then(result=>result.rowCount?next():next(new AppError(403,"INSUFFICIENT_PERMISSION","You do not have permission to perform this action."))).catch(next);
module.exports={createAuthenticate,requireRoles,requirePermission};
