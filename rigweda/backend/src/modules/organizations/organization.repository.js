const columns = `id, code, name, legal_name AS "legalName", registration_number AS "registrationNumber",
  tax_identifier AS "taxIdentifier", email, phone, website, logo_url AS "logoUrl", status, timezone,
  locale, currency, fiscal_year_start_month AS "fiscalYearStartMonth", address, theme, version,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

class OrganizationRepository {
  constructor(pool) { this.pool = pool; }

  async list({ page, pageSize, search, status }) {
    const values = [];
    const where = [];
    if (search) { values.push(`%${search}%`); where.push(`(name ILIKE $${values.length} OR code ILIKE $${values.length})`); }
    if (status !== "all") { values.push(status); where.push(`status = $${values.length}`); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const count = await this.pool.query(`SELECT COUNT(*)::int AS total FROM organizations ${clause}`, values);
    values.push(pageSize, (page - 1) * pageSize);
    const result = await this.pool.query(`SELECT ${columns} FROM organizations ${clause} ORDER BY name ASC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { items: result.rows, total: count.rows[0].total };
  }

  async findById(id) {
    const result = await this.pool.query(`SELECT ${columns} FROM organizations WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  async create(data) {
    const result = await this.pool.query(`INSERT INTO organizations
      (code,name,legal_name,registration_number,tax_identifier,email,phone,website,logo_url,status,timezone,locale,currency,fiscal_year_start_month,address,theme)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING ${columns}`,
      [data.code,data.name,data.legalName||null,data.registrationNumber||null,data.taxIdentifier||null,data.email||null,data.phone||null,data.website||null,data.logoUrl||null,data.status||"active",data.timezone||"Asia/Kolkata",data.locale||"en-IN",data.currency||"INR",data.fiscalYearStartMonth||4,data.address||{},data.theme||{preset:"emerald",appearance:"light"}]);
    return result.rows[0];
  }

  async update(id, data) {
    const map = { name:"name",legalName:"legal_name",registrationNumber:"registration_number",taxIdentifier:"tax_identifier",email:"email",phone:"phone",website:"website",logoUrl:"logo_url",status:"status",timezone:"timezone",locale:"locale",currency:"currency",fiscalYearStartMonth:"fiscal_year_start_month",address:"address",theme:"theme" };
    const entries = Object.entries(data).filter(([key]) => key !== "version" && map[key]);
    const values = entries.map(([, value]) => value === "" ? null : value);
    const sets = entries.map(([key], index) => `${map[key]} = $${index + 1}`);
    values.push(id, data.version);
    const result = await this.pool.query(`UPDATE organizations SET ${sets.join(", ")}, version = version + 1 WHERE id = $${values.length - 1} AND version = $${values.length} RETURNING ${columns}`, values);
    return result.rows[0] || null;
  }
}

module.exports = { OrganizationRepository };
