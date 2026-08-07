const Joi = require("joi");

const uuid = Joi.string().uuid();
const nullableUuid = uuid.allow(null, "");
const optionalText = (maximum) => Joi.string().trim().max(maximum).allow("", null);
const email = Joi.string().trim().lowercase().email().max(254).allow("", null);
const phone = Joi.string().trim().pattern(/^\+?[0-9 ()-]{7,32}$/).allow("", null);
const date = Joi.string().isoDate();

const address = Joi.object({
  addressType: Joi.string().valid("current", "permanent", "mailing").required(),
  line1: Joi.string().trim().min(2).max(200).required(),
  line2: optionalText(200),
  city: Joi.string().trim().min(2).max(100).required(),
  state: optionalText(100),
  postalCode: optionalText(20),
  country: Joi.string().trim().uppercase().length(2).required(),
  isPrimary: Joi.boolean().default(false)
});

const emergencyContact = Joi.object({
  name: Joi.string().trim().min(2).max(160).required(),
  relationship: Joi.string().trim().min(2).max(80).required(),
  phone: Joi.string().trim().pattern(/^\+?[0-9 ()-]{7,32}$/).required(),
  alternatePhone: phone,
  email,
  isPrimary: Joi.boolean().default(false)
});

const identifier = Joi.object({
  identifierType: Joi.string().trim().lowercase().pattern(/^[a-z0-9_]{2,40}$/).required(),
  identifierValue: Joi.string().trim().min(4).max(200).required(),
  country: Joi.string().trim().uppercase().length(2).required(),
  expiresOn: date.allow(null, "")
});

const document = Joi.object({
  documentType: Joi.string().trim().lowercase().pattern(/^[a-z0-9_]{2,50}$/).required(),
  fileName: Joi.string().trim().min(1).max(255).required(),
  fileUrl: Joi.string().trim().uri({scheme: ["http", "https"]}).max(1000).required(),
  mimeType: Joi.string().valid("application/pdf", "image/jpeg", "image/png", "image/webp").required(),
  sizeBytes: Joi.number().integer().min(0).max(20 * 1024 * 1024).allow(null),
  expiresOn: date.allow(null, "")
});

const employeeFields = {
  userId: nullableUuid,
  employeeNumber: Joi.string().trim().uppercase().pattern(/^[A-Z0-9][A-Z0-9_/-]{1,39}$/),
  firstName: Joi.string().trim().min(1).max(100),
  middleName: optionalText(100),
  lastName: Joi.string().trim().min(1).max(100),
  preferredName: optionalText(100),
  workEmail: email,
  personalEmail: email,
  workPhone: phone,
  personalPhone: phone,
  dateOfBirth: date.allow(null, ""),
  gender: Joi.string().valid("female", "male", "non_binary", "self_described", "prefer_not_to_say").allow(null, ""),
  pronouns: optionalText(60),
  maritalStatus: Joi.string().valid("single", "married", "domestic_partnership", "separated", "divorced", "widowed", "prefer_not_to_say").allow(null, ""),
  bloodGroup: optionalText(8),
  nationality: Joi.string().trim().uppercase().length(2).allow(null, ""),
  profilePhotoUrl: Joi.string().trim().uri({scheme: ["http", "https"]}).max(1000).allow("", null),
  biography: optionalText(1000),
  employmentType: Joi.string().valid("full_time", "part_time", "contract", "intern", "temporary", "apprentice"),
  workMode: Joi.string().valid("onsite", "hybrid", "remote"),
  joinDate: date,
  probationEndDate: date.allow(null, ""),
  confirmationDate: date.allow(null, ""),
  probationPeriodDays: Joi.number().integer().min(0).max(730),
  noticePeriodDays: Joi.number().integer().min(0).max(730),
  benefitsEligible: Joi.boolean(),
  departmentId: nullableUuid,
  jobTitleId: nullableUuid,
  workLocationId: nullableUuid,
  managerEmployeeId: nullableUuid,
  costCenter: optionalText(80),
  timezone: optionalText(64),
  metadata: Joi.object().unknown(true),
  addresses: Joi.array().items(address).max(3).unique("addressType"),
  emergencyContacts: Joi.array().items(emergencyContact).max(10),
  identifiers: Joi.array().items(identifier).max(20).unique((a,b)=>a.identifierType===b.identifierType&&a.country===b.country),
  documents: Joi.array().items(document).max(30),
  effectiveDate: date,
  changeReason: optionalText(300)
};

const envelope = (body, params = {}, query = {}) => Joi.object({
  body,
  params: Joi.object(params),
  query: Joi.object(query)
});

const createEmployeeSchema = envelope(Joi.object({
  ...employeeFields,
  employeeNumber: employeeFields.employeeNumber.required(),
  firstName: employeeFields.firstName.required(),
  lastName: employeeFields.lastName.required(),
  employmentType: employeeFields.employmentType.required(),
  workMode: employeeFields.workMode.default("onsite"),
  joinDate: employeeFields.joinDate.required(),
  employmentStatus: Joi.string().valid("preboarding", "probation", "active").default("preboarding"),
  addresses: employeeFields.addresses.default([]),
  emergencyContacts: employeeFields.emergencyContacts.default([]),
  identifiers: Joi.forbidden(),
  documents: Joi.forbidden()
}).required());

const updateEmployeeSchema = envelope(Joi.object({
  ...employeeFields,
  identifiers: Joi.forbidden(),
  documents: Joi.forbidden(),
  version: Joi.number().integer().positive().required()
}).min(2).required(), {employeeId: uuid.required()});

const lifecycleSchema = envelope(Joi.object({
  status: Joi.string().valid("preboarding", "probation", "active", "on_leave", "notice_period", "suspended", "terminated").required(),
  effectiveDate: date.required(),
  reason: optionalText(500),
  version: Joi.number().integer().positive().required()
}).required(), {employeeId: uuid.required()});

const employeeIdSchema = envelope(Joi.object(), {employeeId: uuid.required()});

const listEmployeesSchema = envelope(Joi.object(), {}, {
  page: Joi.number().integer().min(1).default(1),
  pageSize: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().max(100).allow("").default(""),
  status: Joi.string().valid("preboarding", "probation", "active", "on_leave", "notice_period", "suspended", "terminated", "all").default("all"),
  employmentType: Joi.string().valid("full_time", "part_time", "contract", "intern", "temporary", "apprentice", "all").default("all"),
  departmentId: nullableUuid,
  workLocationId: nullableUuid,
  managerEmployeeId: nullableUuid,
  sort: Joi.string().valid("name", "employeeNumber", "joinDate", "status").default("name"),
  direction: Joi.string().valid("asc", "desc").default("asc")
  ,includeArchived: Joi.boolean().default(false)
});

const exportEmployeesSchema = envelope(Joi.object(), {}, {
  search: Joi.string().trim().max(100).allow("").default(""),
  status: Joi.string().valid("preboarding", "probation", "active", "on_leave", "notice_period", "suspended", "terminated", "all").default("all"),
  employmentType: Joi.string().valid("full_time", "part_time", "contract", "intern", "temporary", "apprentice", "all").default("all"),
  departmentId: nullableUuid,
  workLocationId: nullableUuid,
  managerEmployeeId: nullableUuid
  ,includeArchived: Joi.boolean().default(false)
});

const bulkUpdateEmployeesSchema = envelope(Joi.object({
  employeeIds: Joi.array().items(uuid).min(1).max(500).unique().required(),
  departmentId: nullableUuid,
  jobTitleId: nullableUuid,
  workLocationId: nullableUuid,
  managerEmployeeId: nullableUuid,
  employmentType: employeeFields.employmentType,
  workMode: employeeFields.workMode,
  effectiveDate: date.required(),
  changeReason: Joi.string().trim().min(2).max(300).required()
}).or("departmentId","jobTitleId","workLocationId","managerEmployeeId","employmentType","workMode").required());

const archiveEmployeeSchema = envelope(Joi.object({
  version: Joi.number().integer().positive().required(),
  reason: Joi.string().trim().min(2).max(500).required()
}).required(), {employeeId: uuid.required()});

const selfProfileSchema = envelope(Joi.object({
  firstName: employeeFields.firstName,
  middleName: employeeFields.middleName,
  lastName: employeeFields.lastName,
  preferredName: employeeFields.preferredName,
  personalEmail: employeeFields.personalEmail,
  personalPhone: employeeFields.personalPhone,
  dateOfBirth: employeeFields.dateOfBirth,
  gender: employeeFields.gender,
  pronouns: employeeFields.pronouns,
  maritalStatus: employeeFields.maritalStatus,
  bloodGroup: employeeFields.bloodGroup,
  nationality: employeeFields.nationality,
  profilePhotoUrl: employeeFields.profilePhotoUrl,
  biography: employeeFields.biography,
  addresses: employeeFields.addresses,
  emergencyContacts: employeeFields.emergencyContacts,
  identifiers: employeeFields.identifiers,
  documents: employeeFields.documents,
  version: Joi.number().integer().positive().required()
}).min(2).required());

const upcomingEventsSchema = envelope(Joi.object(), {}, {days: Joi.number().integer().min(1).max(365).default(45)});
const reopenProfileSchema = envelope(Joi.object({version: Joi.number().integer().positive().required()}).required(), {employeeId: uuid.required()});
const sensitiveRecordsSchema = envelope(Joi.object({
  identifiers: employeeFields.identifiers,
  documents: employeeFields.documents,
  version: Joi.number().integer().positive().required()
}).or("identifiers","documents").required(), {employeeId: uuid.required()});
const addIdentifierSchema = envelope(identifier.required(), {employeeId: uuid.required()});
const addDocumentSchema = envelope(document.required(), {employeeId: uuid.required()});
const protectedRecordIdSchema = envelope(Joi.object(), {employeeId: uuid.required(), recordId: uuid.required()});

module.exports = {
  createEmployeeSchema,
  updateEmployeeSchema,
  lifecycleSchema,
  employeeIdSchema,
  listEmployeesSchema,
  exportEmployeesSchema,
  bulkUpdateEmployeesSchema,
  archiveEmployeeSchema,
  selfProfileSchema,
  upcomingEventsSchema,
  reopenProfileSchema,
  sensitiveRecordsSchema,
  addIdentifierSchema,
  addDocumentSchema,
  protectedRecordIdSchema
};
