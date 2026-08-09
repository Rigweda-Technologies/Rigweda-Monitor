const AuditLog = require("./auditLogs.model");

exports.createAuditLog = async ({
  organizationId,
  userId,
  module,
  action,
  entityId,
  before,
  after,
  req
}) => {
  return AuditLog.create({
    organizationId,
    userId,
    module,
    action,
    entityId,
    before,
    after,
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"]
  });
};

exports.audit = async ({
  req,
  module,
  action,
  entityId,
  before,
  after
}) => {
  return AuditLog.create({
    organizationId: req.user.organizationId,
    userId: req.user?._id || req.user?.userId,
    module,
    action,
    entityId,
    before,
    after,
    ipAddress: req.ip,
    userAgent: req.headers?.["user-agent"] || ""
  });
};
