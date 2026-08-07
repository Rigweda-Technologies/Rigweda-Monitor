require("dotenv").config();
const {loadEnv}=require("../config/env");
const {createPool}=require("../database/pool");
const {createPasswordService}=require("../modules/auth/password.service");

const run=async()=>{
  const env=loadEnv();
  if(!env.BOOTSTRAP_ADMIN_EMAIL||!env.BOOTSTRAP_ADMIN_PASSWORD) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.");
  const pool=createPool(env); const client=await pool.connect();
  try{
    await client.query("BEGIN");
    let organization=(await client.query("SELECT id FROM organizations ORDER BY created_at LIMIT 1")).rows[0];
    if(!organization) organization=(await client.query(`INSERT INTO organizations(code,name,legal_name,email) VALUES('RIGWEDA','Rigweda Workspace','Rigweda Workspace','admin@rigweda.com') RETURNING id`)).rows[0];
    const email=env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
    let user=(await client.query("SELECT id FROM users WHERE email=$1",[email])).rows[0];
    if(!user){
      const passwordHash=await createPasswordService(env.PASSWORD_PEPPER).hash(env.BOOTSTRAP_ADMIN_PASSWORD);
      user=(await client.query("INSERT INTO users(email,display_name,password_hash,email_verified_at) VALUES($1,$2,$3,NOW()) RETURNING id",[email,"Rigweda Administrator",passwordHash])).rows[0];
    }
    const role=(await client.query("SELECT id FROM roles WHERE organization_id=$1 AND key='system_admin'",[organization.id])).rows[0];
    await client.query(`INSERT INTO organization_memberships(organization_id,user_id,role_id,role_key) VALUES($1,$2,$3,'system_admin') ON CONFLICT(organization_id,user_id) DO UPDATE SET role_id=$3,role_key='system_admin',status='active'`,[organization.id,user.id,role.id]);
    await client.query("COMMIT");
    process.stdout.write(`Administrator ready: ${email}\n`);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();await pool.end();}
};
run().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
