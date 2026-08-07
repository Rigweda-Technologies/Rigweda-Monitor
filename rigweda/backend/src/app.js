const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const pinoHttp = require("pino-http");
const fs = require("node:fs");
const path = require("node:path");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yaml");
const cookieParser = require("cookie-parser");
const { createHealthRouter } = require("./routes/health.routes");
const { notFound, errorHandler } = require("./middleware/error-handler");
const { OrganizationRepository } = require("./modules/organizations/organization.repository");
const { OrganizationService } = require("./modules/organizations/organization.service");
const { createOrganizationRouter } = require("./modules/organizations/organization.routes");
const { AuthRepository } = require("./modules/auth/auth.repository");
const { AuthService } = require("./modules/auth/auth.service");
const { createPasswordService } = require("./modules/auth/password.service");
const { createTokenService } = require("./modules/auth/token.service");
const { createAuthenticate, requireRoles, requirePermission } = require("./modules/auth/auth.middleware");
const { createAuthRouter } = require("./modules/auth/auth.routes");
const { AccessRepository } = require("./modules/access/access.repository");
const { AccessService } = require("./modules/access/access.service");
const { createAccessRouter } = require("./modules/access/access.routes");
const { EmployeeRepository } = require("./modules/employees/employee.repository");
const { EmployeeService } = require("./modules/employees/employee.service");
const { createEmployeeRouter } = require("./modules/employees/employee.routes");
const { createFieldEncryption } = require("./modules/employees/field-encryption.service");
const { StructureRepository } = require("./modules/structure/structure.repository");
const { StructureService } = require("./modules/structure/structure.service");
const { createStructureRouter } = require("./modules/structure/structure.routes");
const { AttendanceRepository } = require("./modules/attendance/attendance.repository");
const { AttendanceService } = require("./modules/attendance/attendance.service");
const { createAttendanceRouter } = require("./modules/attendance/attendance.routes");
const { LeaveRepository } = require("./modules/leave/leave.repository");
const { LeaveService } = require("./modules/leave/leave.service");
const { createLeaveRouter } = require("./modules/leave/leave.routes");
const { WorklogsRepository } = require("./modules/worklogs/worklogs.repository");
const { WorklogsService } = require("./modules/worklogs/worklogs.service");
const { createWorklogsRouter } = require("./modules/worklogs/worklogs.routes");
const { PayrollRepository } = require("./modules/payroll/payroll.repository");
const { PayrollService } = require("./modules/payroll/payroll.service");
const { createPayrollRouter } = require("./modules/payroll/payroll.routes");
const { RecruitmentRepository } = require("./modules/recruitment/recruitment.repository");
const { RecruitmentService } = require("./modules/recruitment/recruitment.service");
const { createRecruitmentRouter } = require("./modules/recruitment/recruitment.routes");

const createApp = ({ env, logger, pool = null }) => {
  const app = express();
  const openApiDocument = YAML.parse(fs.readFileSync(path.join(__dirname, "docs/openapi.yaml"), "utf8"));
  const origins = env.CORS_ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, genReqId: (req) => req.headers["x-request-id"] || crypto.randomUUID() }));
  app.use("/api", rateLimit({ windowMs:60_000,limit:env.API_RATE_LIMIT_PER_MINUTE||1200,standardHeaders:"draft-8",legacyHeaders:false,keyGenerator:(req)=>{const bearer=req.get("authorization");return bearer?`session:${crypto.createHash("sha256").update(bearer).digest("base64url")}`:`ip:${ipKeyGenerator(req.ip)}`;} }));
  app.get("/api/v1/openapi.json", (_req, res) => res.json(openApiDocument));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: "Rigweda API" }));
  app.use("/api/v1", createHealthRouter({ pool, startedAt: Date.now() }));
  if (pool) {
    const tokens = createTokenService(env);
    const authenticate = createAuthenticate(tokens);
    const authService = new AuthService({ repository:new AuthRepository(pool), passwords:createPasswordService(env.PASSWORD_PEPPER), tokens, env });
    app.use("/api/v1/auth", createAuthRouter({ service:authService, authenticate, env }));
    const accessService = new AccessService(new AccessRepository(pool),createPasswordService(env.PASSWORD_PEPPER));
    app.use("/api/v1/access",authenticate,requirePermission(pool,"users.manage"),createAccessRouter(accessService));
    const employeeService = new EmployeeService(new EmployeeRepository(pool),createFieldEncryption(env.DATA_ENCRYPTION_KEY));
    const employeePermissions = {
      manageEmployees: requirePermission(pool,"employees.manage"),
      sensitiveEmployees: requirePermission(pool,"employees.sensitive.read"),
      lifecycleEmployees: requirePermission(pool,"employees.lifecycle.manage"),
      exportEmployees: requirePermission(pool,"employees.export"),
      bulkEmployees: requirePermission(pool,"employees.bulk.manage"),
      documentEmployees: requirePermission(pool,"employees.documents.manage"),
      selfReadEmployees: requirePermission(pool,"employees.self.read"),
      selfEditEmployees: requirePermission(pool,"employees.self.edit")
    };
    app.use("/api/v1/employees",authenticate,requirePermission(pool,"employees.read"),createEmployeeRouter(employeeService,employeePermissions));
    const structureService = new StructureService(new StructureRepository(pool));
    app.use("/api/v1/structure",authenticate,requirePermission(pool,"structure.read"),createStructureRouter(structureService,requirePermission(pool,"structure.manage")));
    const attendanceService = new AttendanceService(new AttendanceRepository(pool));
    app.use("/api/v1/attendance",authenticate,requirePermission(pool,"attendance.read"),createAttendanceRouter(attendanceService,{
      self:requirePermission(pool,"attendance.self.manage"),manage:requirePermission(pool,"attendance.manage"),
      approve:requirePermission(pool,"attendance.regularization.approve"),export:requirePermission(pool,"attendance.export")
    }));
    const leaveService = new LeaveService(new LeaveRepository(pool));
    app.use("/api/v1/leave",authenticate,requirePermission(pool,"leave.read"),createLeaveRouter(leaveService,{
      self:requirePermission(pool,"leave.self.manage"),approve:requirePermission(pool,"leave.approve"),
      configure:requirePermission(pool,"leave.configure"),export:requirePermission(pool,"leave.export")
    }));
    const worklogsService = new WorklogsService(new WorklogsRepository(pool));
    app.use("/api/v1/work-logs",authenticate,requirePermission(pool,"worklogs.read"),createWorklogsRouter(worklogsService,{
      self:requirePermission(pool,"worklogs.self.manage"),manage:requirePermission(pool,"worklogs.manage"),
      approve:requirePermission(pool,"worklogs.approve"),export:requirePermission(pool,"worklogs.export")
    }));
    const payrollService = new PayrollService(new PayrollRepository(pool));
    app.use("/api/v1/payroll",authenticate,requirePermission(pool,"payroll.read"),createPayrollRouter(payrollService,{
      self:requirePermission(pool,"payroll.self.read"),manage:requirePermission(pool,"payroll.manage"),
      approve:requirePermission(pool,"payroll.approve"),export:requirePermission(pool,"payroll.export")
    }));
    const recruitmentService = new RecruitmentService(new RecruitmentRepository(pool));
    app.use("/api/v1/recruitment",authenticate,requirePermission(pool,"recruitment.read"),createRecruitmentRouter(recruitmentService,{
      manage:requirePermission(pool,"recruitment.manage"),approve:requirePermission(pool,"recruitment.approve"),
      export:requirePermission(pool,"recruitment.export")
    }));
    const organizationService = new OrganizationService(new OrganizationRepository(pool));
    app.use("/api/v1/organizations", authenticate, requireRoles("system_admin","organization_admin"), createOrganizationRouter(organizationService));
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

module.exports = { createApp };
