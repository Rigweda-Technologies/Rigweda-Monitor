const Joi = require("joi");

const theme = Joi.object({
  preset: Joi.string().valid("emerald", "ocean", "indigo", "amber", "rose", "custom").default("emerald"),
  appearance: Joi.string().valid("light", "dark", "system").default("light"),
  customPrimary: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).allow(null),
  customAccent: Joi.string().pattern(/^#[0-9a-fA-F]{6}$/).allow(null)
});
const address = Joi.object({
  line1: Joi.string().trim().max(200).allow(""), line2: Joi.string().trim().max(200).allow(""),
  city: Joi.string().trim().max(100).allow(""), state: Joi.string().trim().max(100).allow(""),
  postalCode: Joi.string().trim().max(20).allow(""), country: Joi.string().trim().length(2).uppercase().default("IN")
});
const fields = {
  code: Joi.string().trim().uppercase().pattern(/^[A-Z0-9][A-Z0-9_-]{1,31}$/),
  name: Joi.string().trim().min(2).max(160), legalName: Joi.string().trim().max(200).allow("", null),
  registrationNumber: Joi.string().trim().max(80).allow("", null), taxIdentifier: Joi.string().trim().max(80).allow("", null),
  email: Joi.string().trim().lowercase().email().max(254).allow("", null), phone: Joi.string().trim().pattern(/^\+?[0-9 ()-]{7,32}$/).allow("", null),
  website: Joi.string().trim().uri({ scheme: ["http", "https"] }).max(500).allow("", null), logoUrl: Joi.string().trim().uri({ scheme: ["http", "https"] }).max(1000).allow("", null),
  status: Joi.string().valid("active", "inactive"), timezone: Joi.string().trim().max(64), locale: Joi.string().trim().max(16),
  currency: Joi.string().trim().uppercase().length(3), fiscalYearStartMonth: Joi.number().integer().min(1).max(12), address, theme
};
const envelope = (body, extras = {}) => Joi.object({ body, params: Joi.object(extras.params || {}), query: Joi.object(extras.query || {}) });

const createOrganizationSchema = envelope(Joi.object({ ...fields, code: fields.code.required(), name: fields.name.required() }).required());
const updateOrganizationSchema = envelope(Joi.object({ ...fields, code: Joi.forbidden(), version: Joi.number().integer().positive().required() }).min(2).required(), { params: { organizationId: Joi.string().uuid().required() } });
const getOrganizationSchema = envelope(Joi.object(), { params: { organizationId: Joi.string().uuid().required() } });
const listOrganizationsSchema = envelope(Joi.object(), { query: {
  page: Joi.number().integer().min(1).default(1), pageSize: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().trim().max(100).allow("").default(""), status: Joi.string().valid("active", "inactive", "all").default("all")
} });

module.exports = { createOrganizationSchema, updateOrganizationSchema, getOrganizationSchema, listOrganizationsSchema };
