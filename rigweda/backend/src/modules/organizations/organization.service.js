const { AppError } = require("../../lib/app-error");

class OrganizationService {
  constructor(repository) { this.repository = repository; }
  async list(query) {
    const result = await this.repository.list(query);
    return { ...result, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(result.total / query.pageSize) };
  }
  async get(id) {
    const organization = await this.repository.findById(id);
    if (!organization) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");
    return organization;
  }
  async create(data) {
    try { return await this.repository.create(data); }
    catch (error) {
      if (error.code === "23505") throw new AppError(409, "ORGANIZATION_CONFLICT", "An organization with this code or identifier already exists.");
      throw error;
    }
  }
  async update(id, data) {
    try {
      const organization = await this.repository.update(id, data);
      if (!organization) {
        const exists = await this.repository.findById(id);
        if (!exists) throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");
        throw new AppError(409, "VERSION_CONFLICT", "This organization was changed by someone else. Refresh and try again.");
      }
      return organization;
    } catch (error) {
      if (error.code === "23505") throw new AppError(409, "ORGANIZATION_CONFLICT", "An organization with this identifier already exists.");
      throw error;
    }
  }
}

module.exports = { OrganizationService };
