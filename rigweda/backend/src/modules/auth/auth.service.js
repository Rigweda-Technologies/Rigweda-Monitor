const { AppError } = require("../../lib/app-error");

const publicUser = (user) => ({ id:user.id,email:user.email,displayName:user.displayName,status:user.status,
  organizationId:user.organizationId,organizationName:user.organizationName,organizationTheme:user.organizationTheme,roleKey:user.roleKey });

class AuthService {
  constructor({ repository, passwords, tokens, env }) { Object.assign(this,{repository,passwords,tokens,env}); }
  assertUsable(user) {
    if (user.status !== "active" || user.membershipStatus !== "active") throw new AppError(403,"ACCOUNT_UNAVAILABLE","This account is not available.");
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) throw new AppError(423,"ACCOUNT_LOCKED","Too many failed attempts. Try again later.");
  }
  async login({ email, password, userAgent, ipAddress }) {
    const user = await this.repository.findByEmail(email);
    if (!user) {
      await this.repository.event({type:"login_failed",email,ipAddress,userAgent,metadata:{reason:"unknown_email"}});
      throw new AppError(401,"INVALID_CREDENTIALS","Email or password is incorrect.");
    }
    this.assertUsable(user);
    if (!(await this.passwords.verify(user.passwordHash,password))) {
      await this.repository.recordFailure(user.id,this.env.AUTH_MAX_FAILED_ATTEMPTS,this.env.AUTH_LOCK_MINUTES);
      await this.repository.event({userId:user.id,type:"login_failed",email,ipAddress,userAgent,metadata:{reason:"invalid_password"}});
      throw new AppError(401,"INVALID_CREDENTIALS","Email or password is incorrect.");
    }
    await this.repository.recordSuccess(user.id);
    const refreshToken=this.tokens.createRefreshToken();
    const expiresAt=this.tokens.refreshExpiresAt();
    const sessionId=await this.repository.createSession({userId:user.id,tokenHash:this.tokens.hashRefreshToken(refreshToken),userAgent,ipAddress,expiresAt});
    await this.repository.event({userId:user.id,type:"login_succeeded",email,ipAddress,userAgent,metadata:{sessionId}});
    return {user:publicUser(user),accessToken:this.tokens.createAccessToken(user,sessionId),refreshToken,refreshExpiresAt:expiresAt};
  }
  async refresh(refreshToken) {
    if (!refreshToken) throw new AppError(401,"SESSION_REQUIRED","Your session has expired.");
    const oldHash=this.tokens.hashRefreshToken(refreshToken);
    const user=await this.repository.findSession(oldHash);
    if (!user || user.revokedAt || new Date(user.expiresAt)<=new Date()) throw new AppError(401,"INVALID_SESSION","Your session is no longer valid.");
    this.assertUsable(user);
    const next=this.tokens.createRefreshToken(); const nextHash=this.tokens.hashRefreshToken(next); const expiresAt=this.tokens.refreshExpiresAt();
    if (!(await this.repository.rotateSession(user.sessionId,oldHash,nextHash,expiresAt))) throw new AppError(401,"SESSION_REUSED","The session could not be rotated.");
    return {user:publicUser(user),accessToken:this.tokens.createAccessToken(user,user.sessionId),refreshToken:next,refreshExpiresAt:expiresAt};
  }
  async me(userId) { const user=await this.repository.findPublicById(userId); if(!user) throw new AppError(401,"USER_NOT_FOUND","User not found."); this.assertUsable(user); return publicUser(user); }
  async logout(refreshToken) { if(refreshToken) await this.repository.revokeSession(this.tokens.hashRefreshToken(refreshToken)); }
  async changePassword(userId,currentSessionId,currentPassword,newPassword) {
    const user=await this.repository.findWithPasswordById(userId);
    if(!user||!(await this.passwords.verify(user.passwordHash,currentPassword))) throw new AppError(401,"CURRENT_PASSWORD_INVALID","Current password is incorrect.");
    if(await this.passwords.verify(user.passwordHash,newPassword)) throw new AppError(422,"PASSWORD_UNCHANGED","New password must be different.");
    await this.repository.updatePassword(userId,await this.passwords.hash(newPassword),currentSessionId);
    await this.repository.event({userId,type:"password_changed",email:user.email,metadata:{currentSessionPreserved:true}});
  }
  async requestPasswordReset(email,ipAddress,userAgent) {
    const user=await this.repository.findByEmail(email); if(!user||user.status!=="active") return null;
    const token=this.tokens.createRefreshToken();
    await this.repository.createResetToken(user.id,this.tokens.hashRefreshToken(token),new Date(Date.now()+30*60_000),ipAddress);
    await this.repository.event({userId:user.id,type:"password_reset_requested",email,ipAddress,userAgent}); return token;
  }
  async resetPassword(token,newPassword,ipAddress,userAgent) {
    if(!token) throw new AppError(422,"RESET_TOKEN_REQUIRED","Reset token is required.");
    const userId=await this.repository.consumeResetToken(this.tokens.hashRefreshToken(token),await this.passwords.hash(newPassword));
    if(!userId) throw new AppError(422,"RESET_TOKEN_INVALID","Reset link is invalid or expired.");
    await this.repository.event({userId,type:"password_reset_completed",ipAddress,userAgent});
  }
  listSessions(userId,currentSessionId){return this.repository.listSessions(userId,currentSessionId);}
  async revokeSession(userId,currentSessionId,sessionId){if(sessionId===currentSessionId)throw new AppError(422,"CURRENT_SESSION","Use sign out to close the current session.");if(!(await this.repository.revokeSessionForUser(userId,sessionId)))throw new AppError(404,"SESSION_NOT_FOUND","Session not found.");}
  revokeOtherSessions(userId,currentSessionId){return this.repository.revokeOtherSessions(userId,currentSessionId);}
  getPreferences(userId){return this.repository.getPreferences(userId);}
  updatePreferences(userId,data){return this.repository.updatePreferences(userId,data);}
}

module.exports = { AuthService };
