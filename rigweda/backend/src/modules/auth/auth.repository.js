const publicColumns = `u.id, u.email, u.display_name AS "displayName", u.status, u.locked_until AS "lockedUntil",
  m.organization_id AS "organizationId", m.role_key AS "roleKey", m.status AS "membershipStatus",
  o.name AS "organizationName", o.theme AS "organizationTheme",
  r.name AS "roleName",
  COALESCE(p.permissions,'[]'::jsonb) AS permissions`;
const membershipJoin = `LEFT JOIN LATERAL (SELECT * FROM organization_memberships WHERE user_id=u.id AND status='active' ORDER BY created_at LIMIT 1) m ON TRUE
  LEFT JOIN roles r ON r.id=m.role_id
  LEFT JOIN LATERAL (SELECT jsonb_agg(rp.permission_key ORDER BY rp.permission_key) AS permissions FROM role_permissions rp WHERE rp.role_id=r.id) p ON TRUE
  LEFT JOIN organizations o ON o.id=m.organization_id`;

class AuthRepository {
  constructor(pool) { this.pool = pool; }
  async findByEmail(email) {
    const result = await this.pool.query(`SELECT ${publicColumns}, u.password_hash AS "passwordHash", u.failed_login_attempts AS "failedLoginAttempts"
      FROM users u ${membershipJoin} WHERE u.email=$1`, [email]);
    return result.rows[0] || null;
  }
  async findPublicById(id) {
    const result = await this.pool.query(`SELECT ${publicColumns} FROM users u ${membershipJoin} WHERE u.id=$1`, [id]);
    return result.rows[0] || null;
  }
  async recordFailure(userId, maxAttempts, lockMinutes) {
    await this.pool.query(`UPDATE users SET failed_login_attempts=failed_login_attempts+1,
      locked_until=CASE WHEN failed_login_attempts+1 >= $2 THEN NOW()+($3 * INTERVAL '1 minute') ELSE locked_until END WHERE id=$1`, [userId,maxAttempts,lockMinutes]);
  }
  async recordSuccess(userId) {
    await this.pool.query("UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_login_at=NOW() WHERE id=$1", [userId]);
  }
  async createSession({ userId, tokenHash, userAgent, ipAddress, expiresAt }) {
    const result = await this.pool.query(`INSERT INTO auth_sessions(user_id,refresh_token_hash,user_agent,ip_address,expires_at)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [userId,tokenHash,userAgent||null,ipAddress||null,expiresAt]);
    return result.rows[0].id;
  }
  async findSession(tokenHash) {
    const result = await this.pool.query(`SELECT s.id AS "sessionId", s.user_id AS id, s.expires_at AS "expiresAt", s.revoked_at AS "revokedAt",
      ${publicColumns.replace("u.id, ", "")} FROM auth_sessions s JOIN users u ON u.id=s.user_id
      ${membershipJoin} WHERE s.refresh_token_hash=$1`, [tokenHash]);
    return result.rows[0] || null;
  }
  async rotateSession(sessionId, oldHash, newHash, expiresAt) {
    const result = await this.pool.query(`UPDATE auth_sessions SET refresh_token_hash=$3,expires_at=$4,last_used_at=NOW()
      WHERE id=$1 AND refresh_token_hash=$2 AND revoked_at IS NULL AND expires_at>NOW() RETURNING id`, [sessionId,oldHash,newHash,expiresAt]);
    return result.rowCount === 1;
  }
  async revokeSession(tokenHash, reason="logout") {
    await this.pool.query("UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,NOW()),revoke_reason=$2 WHERE refresh_token_hash=$1", [tokenHash,reason]);
  }
  async findWithPasswordById(id) {
    const result=await this.pool.query("SELECT id,email,password_hash AS \"passwordHash\",status FROM users WHERE id=$1",[id]);
    return result.rows[0]||null;
  }
  async updatePassword(userId,passwordHash,currentSessionId=null) {
    const client=await this.pool.connect();
    try { await client.query("BEGIN");
      await client.query("UPDATE users SET password_hash=$2,password_changed_at=NOW(),failed_login_attempts=0,locked_until=NULL WHERE id=$1",[userId,passwordHash]);
      await client.query("UPDATE auth_sessions SET revoked_at=NOW(),revoke_reason='password_changed' WHERE user_id=$1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id<>$2)",[userId,currentSessionId]);
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async listSessions(userId,currentSessionId) {
    const result=await this.pool.query(`SELECT id,user_agent AS "userAgent",host(ip_address) AS "ipAddress",created_at AS "createdAt",last_used_at AS "lastUsedAt",expires_at AS "expiresAt",id=$2 AS "current" FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>NOW() ORDER BY last_used_at DESC`,[userId,currentSessionId]);
    return result.rows;
  }
  async revokeSessionForUser(userId,sessionId) {
    const result=await this.pool.query("UPDATE auth_sessions SET revoked_at=NOW(),revoke_reason='user_revoked' WHERE id=$2 AND user_id=$1 AND revoked_at IS NULL RETURNING id",[userId,sessionId]);
    return result.rowCount===1;
  }
  async revokeOtherSessions(userId,currentSessionId) {
    const result=await this.pool.query("UPDATE auth_sessions SET revoked_at=NOW(),revoke_reason='user_revoked_others' WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL",[userId,currentSessionId]);
    return result.rowCount;
  }
  async createResetToken(userId,tokenHash,expiresAt,ipAddress) {
    await this.pool.query("UPDATE password_reset_tokens SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL",[userId]);
    await this.pool.query("INSERT INTO password_reset_tokens(user_id,token_hash,expires_at,requested_ip) VALUES($1,$2,$3,$4)",[userId,tokenHash,expiresAt,ipAddress||null]);
  }
  async consumeResetToken(tokenHash,passwordHash) {
    const client=await this.pool.connect();
    try { await client.query("BEGIN");
      const token=(await client.query("SELECT id,user_id AS \"userId\" FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE",[tokenHash])).rows[0];
      if(!token){await client.query("ROLLBACK");return null;}
      await client.query("UPDATE password_reset_tokens SET used_at=NOW() WHERE id=$1",[token.id]);
      await client.query("UPDATE users SET password_hash=$2,password_changed_at=NOW(),failed_login_attempts=0,locked_until=NULL WHERE id=$1",[token.userId,passwordHash]);
      await client.query("UPDATE auth_sessions SET revoked_at=NOW(),revoke_reason='password_reset' WHERE user_id=$1 AND revoked_at IS NULL",[token.userId]);
      await client.query("COMMIT"); return token.userId;
    } catch(error){await client.query("ROLLBACK");throw error;} finally{client.release();}
  }
  async getPreferences(userId) {
    const result=await this.pool.query("SELECT theme,timezone,locale FROM user_preferences WHERE user_id=$1",[userId]);
    return result.rows[0]||{theme:null,timezone:null,locale:null};
  }
  async updatePreferences(userId,data) {
    const result=await this.pool.query(`INSERT INTO user_preferences(user_id,theme,timezone,locale) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id) DO UPDATE SET theme=COALESCE(EXCLUDED.theme,user_preferences.theme),timezone=COALESCE(EXCLUDED.timezone,user_preferences.timezone),locale=COALESCE(EXCLUDED.locale,user_preferences.locale)
      RETURNING theme,timezone,locale`,[userId,data.theme||null,data.timezone||null,data.locale||null]);
    return result.rows[0];
  }
  async event({ userId=null, type, email=null, ipAddress=null, userAgent=null, metadata={} }) {
    await this.pool.query(`INSERT INTO auth_events(user_id,event_type,email,ip_address,user_agent,metadata) VALUES($1,$2,$3,$4,$5,$6)`,
      [userId,type,email,ipAddress,userAgent,metadata]);
  }
}

module.exports = { AuthRepository };
