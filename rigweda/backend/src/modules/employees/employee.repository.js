const scalarColumns = {
  userId: "user_id",
  employeeNumber: "employee_number",
  firstName: "first_name",
  middleName: "middle_name",
  lastName: "last_name",
  preferredName: "preferred_name",
  workEmail: "work_email",
  personalEmail: "personal_email",
  workPhone: "work_phone",
  personalPhone: "personal_phone",
  dateOfBirth: "date_of_birth",
  gender: "gender",
  pronouns: "pronouns",
  maritalStatus: "marital_status",
  bloodGroup: "blood_group",
  nationality: "nationality",
  profilePhotoUrl: "profile_photo_url",
  biography: "biography",
  employmentType: "employment_type",
  workMode: "work_mode",
  joinDate: "join_date",
  probationEndDate: "probation_end_date",
  confirmationDate: "confirmation_date",
  probationPeriodDays: "probation_period_days",
  noticePeriodDays: "notice_period_days",
  benefitsEligible: "benefits_eligible",
  profileCompleted: "profile_completed",
  departmentId: "department_id",
  jobTitleId: "job_title_id",
  workLocationId: "work_location_id",
  managerEmployeeId: "manager_employee_id",
  costCenter: "cost_center",
  timezone: "timezone",
  metadata: "metadata"
};

const employeeColumns = `e.id,e.organization_id AS "organizationId",e.user_id AS "userId",
  e.employee_number AS "employeeNumber",e.first_name AS "firstName",e.middle_name AS "middleName",
  e.last_name AS "lastName",e.preferred_name AS "preferredName",
  CONCAT_WS(' ',e.first_name,NULLIF(e.middle_name,''),e.last_name) AS "fullName",
  e.work_email AS "workEmail",e.personal_email AS "personalEmail",e.work_phone AS "workPhone",
  e.personal_phone AS "personalPhone",e.date_of_birth AS "dateOfBirth",e.gender,e.pronouns,
  e.marital_status AS "maritalStatus",e.blood_group AS "bloodGroup",e.nationality,
  e.profile_photo_url AS "profilePhotoUrl",e.biography,e.employment_status AS "employmentStatus",
  e.employment_type AS "employmentType",e.work_mode AS "workMode",e.join_date AS "joinDate",
  e.probation_end_date AS "probationEndDate",e.confirmation_date AS "confirmationDate",
  e.probation_period_days AS "probationPeriodDays",e.notice_period_days AS "noticePeriodDays",
  e.benefits_eligible AS "benefitsEligible",e.profile_completed AS "profileCompleted",
  e.notice_start_date AS "noticeStartDate",e.last_working_date AS "lastWorkingDate",
  e.notice_end_date AS "noticeEndDate",
  e.termination_date AS "terminationDate",e.termination_reason AS "terminationReason",
  e.department_id AS "departmentId",d.name AS "departmentName",e.job_title_id AS "jobTitleId",
  jt.name AS "jobTitleName",e.work_location_id AS "workLocationId",wl.name AS "workLocationName",
  e.manager_employee_id AS "managerEmployeeId",
  CONCAT_WS(' ',manager.first_name,manager.last_name) AS "managerName",e.cost_center AS "costCenter",
  e.timezone,e.metadata,e.version,e.archived_at AS "archivedAt",e.created_at AS "createdAt",e.updated_at AS "updatedAt"`;

const employeeJoins = `LEFT JOIN departments d ON d.id=e.department_id
  LEFT JOIN job_titles jt ON jt.id=e.job_title_id
  LEFT JOIN work_locations wl ON wl.id=e.work_location_id
  LEFT JOIN employees manager ON manager.id=e.manager_employee_id`;

const directoryColumns = `e.id,e.employee_number AS "employeeNumber",e.first_name AS "firstName",
  e.last_name AS "lastName",e.preferred_name AS "preferredName",
  CONCAT_WS(' ',e.first_name,NULLIF(e.middle_name,''),e.last_name) AS "fullName",
  e.work_email AS "workEmail",e.work_phone AS "workPhone",e.profile_photo_url AS "profilePhotoUrl",
  e.employment_status AS "employmentStatus",e.employment_type AS "employmentType",e.work_mode AS "workMode",
  e.join_date AS "joinDate",e.department_id AS "departmentId",d.name AS "departmentName",
  e.job_title_id AS "jobTitleId",jt.name AS "jobTitleName",e.work_location_id AS "workLocationId",
  wl.name AS "workLocationName",e.manager_employee_id AS "managerEmployeeId",
  CONCAT_WS(' ',manager.first_name,manager.last_name) AS "managerName",e.profile_completed AS "profileCompleted",
  e.archived_at AS "archivedAt",e.version`;

const nullable = (value) => value === "" || value === undefined ? null : value;
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

class EmployeeRepository {
  constructor(pool) { this.pool = pool; }

  filters(organizationId, query) {
    const values = [organizationId];
    const where = ["e.organization_id=$1"];
    if (query.onlyArchived) where.push("e.archived_at IS NOT NULL");
    else if (!query.includeArchived) where.push("e.archived_at IS NULL");
    if (query.search) {
      values.push(`%${query.search}%`);
      const position = values.length;
      where.push(`(e.employee_number ILIKE $${position} OR e.first_name ILIKE $${position} OR e.last_name ILIKE $${position} OR CONCAT_WS(' ',e.first_name,e.last_name) ILIKE $${position} OR e.work_email ILIKE $${position})`);
    }
    if (query.status && query.status !== "all") { values.push(query.status); where.push(`e.employment_status=$${values.length}`); }
    if (query.employmentType && query.employmentType !== "all") { values.push(query.employmentType); where.push(`e.employment_type=$${values.length}`); }
    for (const [key, column] of [["departmentId","department_id"],["workLocationId","work_location_id"],["managerEmployeeId","manager_employee_id"]]) {
      if (query[key]) { values.push(query[key]); where.push(`e.${column}=$${values.length}`); }
    }
    return {values, clause: `WHERE ${where.join(" AND ")}`};
  }

  async list(organizationId, query) {
    const {values, clause} = this.filters(organizationId, query);
    const count = await this.pool.query(`SELECT COUNT(*)::int AS total FROM employees e ${clause}`, values);
    const sortColumns = {name: "e.first_name", employeeNumber: "e.employee_number", joinDate: "e.join_date", status: "e.employment_status"};
    const order = `${sortColumns[query.sort] || sortColumns.name} ${query.direction === "desc" ? "DESC" : "ASC"},e.last_name ASC,e.id ASC`;
    values.push(query.pageSize, (query.page - 1) * query.pageSize);
    const result = await this.pool.query(`SELECT ${directoryColumns} FROM employees e ${employeeJoins} ${clause} ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return {items: result.rows, total: count.rows[0].total};
  }

  async summary(organizationId) {
    const result = await this.pool.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER(WHERE employment_status='active')::int AS active,
      COUNT(*) FILTER(WHERE employment_status='probation')::int AS probation,
      COUNT(*) FILTER(WHERE employment_status='on_leave')::int AS "onLeave",
      COUNT(*) FILTER(WHERE employment_status='notice_period')::int AS "noticePeriod",
      COUNT(*) FILTER(WHERE employment_status='preboarding')::int AS preboarding
      FROM employees WHERE organization_id=$1 AND archived_at IS NULL`, [organizationId]);
    return result.rows[0];
  }

  async metadata(organizationId) {
    const [departments, jobTitles, workLocations, managers, availableUsers] = await Promise.all([
      this.pool.query(`SELECT id,code,name FROM departments WHERE organization_id=$1 AND status='active' ORDER BY name`, [organizationId]),
      this.pool.query(`SELECT id,code,name,job_level AS "jobLevel" FROM job_titles WHERE organization_id=$1 AND status='active' ORDER BY name`, [organizationId]),
      this.pool.query(`SELECT id,code,name,location_type AS "locationType",timezone FROM work_locations WHERE organization_id=$1 AND status='active' ORDER BY name`, [organizationId]),
      this.pool.query(`SELECT id,employee_number AS "employeeNumber",CONCAT_WS(' ',first_name,last_name) AS name FROM employees WHERE organization_id=$1 AND employment_status<>'terminated' AND archived_at IS NULL ORDER BY first_name,last_name`, [organizationId]),
      this.pool.query(`SELECT u.id,u.email,u.display_name AS "displayName" FROM organization_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN employees e ON e.organization_id=m.organization_id AND e.user_id=u.id WHERE m.organization_id=$1 AND m.status='active' AND e.id IS NULL ORDER BY u.display_name`, [organizationId])
    ]);
    return {departments: departments.rows, jobTitles: jobTitles.rows, workLocations: workLocations.rows, managers: managers.rows, availableUsers: availableUsers.rows};
  }

  async findById(organizationId, employeeId) {
    const result = await this.pool.query(`SELECT ${employeeColumns} FROM employees e ${employeeJoins} WHERE e.organization_id=$1 AND e.id=$2`, [organizationId, employeeId]);
    if (!result.rows[0]) return null;
    const [addresses, emergencyContacts, identifiers, documents] = await Promise.all([
      this.pool.query(`SELECT id,address_type AS "addressType",line1,line2,city,state,postal_code AS "postalCode",country,is_primary AS "isPrimary" FROM employee_addresses WHERE employee_id=$1 ORDER BY is_primary DESC,address_type`, [employeeId]),
      this.pool.query(`SELECT id,name,relationship,phone,alternate_phone AS "alternatePhone",email,is_primary AS "isPrimary" FROM employee_emergency_contacts WHERE employee_id=$1 ORDER BY is_primary DESC,name`, [employeeId]),
      this.pool.query(`SELECT id,identifier_type AS "identifierType",country,masked_value AS "maskedValue",expires_on AS "expiresOn",verified_at AS "verifiedAt" FROM employee_identifiers WHERE employee_id=$1 ORDER BY identifier_type`, [employeeId]),
      this.pool.query(`SELECT id,document_type AS "documentType",file_name AS "fileName",file_url AS "fileUrl",mime_type AS "mimeType",size_bytes AS "sizeBytes",expires_on AS "expiresOn",verified_at AS "verifiedAt",created_at AS "createdAt" FROM employee_documents WHERE employee_id=$1 ORDER BY created_at DESC`, [employeeId])
    ]);
    return {...result.rows[0], addresses: addresses.rows, emergencyContacts: emergencyContacts.rows, identifiers: identifiers.rows, documents: documents.rows};
  }

  async findByUserId(organizationId, userId) {
    const result = await this.pool.query("SELECT id FROM employees WHERE organization_id=$1 AND user_id=$2 AND archived_at IS NULL", [organizationId,userId]);
    return result.rows[0] ? this.findById(organizationId,result.rows[0].id) : null;
  }

  async validateReferences(client, organizationId, data) {
    const references = [
      ["departmentId", "departments"],
      ["jobTitleId", "job_titles"],
      ["workLocationId", "work_locations"],
      ["managerEmployeeId", "employees"]
    ];
    for (const [key, table] of references) {
      if (!data[key]) continue;
      const result = await client.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`, [data[key], organizationId]);
      if (!result.rowCount) return key;
    }
    if (data.userId) {
      const result = await client.query(`SELECT 1 FROM organization_memberships WHERE user_id=$1 AND organization_id=$2 AND status='active'`, [data.userId, organizationId]);
      if (!result.rowCount) return "userId";
    }
    return null;
  }

  async managerCreatesCycle(client, organizationId, employeeId, managerEmployeeId) {
    if (!managerEmployeeId) return false;
    const result = await client.query(`WITH RECURSIVE manager_chain AS (
      SELECT id,manager_employee_id FROM employees WHERE id=$1 AND organization_id=$2
      UNION ALL
      SELECT e.id,e.manager_employee_id FROM employees e JOIN manager_chain c ON e.id=c.manager_employee_id WHERE e.organization_id=$2
    ) SELECT 1 FROM manager_chain WHERE id=$3 LIMIT 1`, [managerEmployeeId, organizationId, employeeId]);
    return result.rowCount > 0;
  }

  async replaceAddresses(client, employeeId, addresses) {
    await client.query("DELETE FROM employee_addresses WHERE employee_id=$1", [employeeId]);
    for (const item of addresses) {
      await client.query(`INSERT INTO employee_addresses(employee_id,address_type,line1,line2,city,state,postal_code,country,is_primary)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [employeeId,item.addressType,item.line1,nullable(item.line2),item.city,nullable(item.state),nullable(item.postalCode),item.country,item.isPrimary || false]);
    }
  }

  async replaceEmergencyContacts(client, employeeId, contacts) {
    await client.query("DELETE FROM employee_emergency_contacts WHERE employee_id=$1", [employeeId]);
    for (const item of contacts) {
      await client.query(`INSERT INTO employee_emergency_contacts(employee_id,name,relationship,phone,alternate_phone,email,is_primary)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [employeeId,item.name,item.relationship,item.phone,nullable(item.alternatePhone),nullable(item.email),item.isPrimary || false]);
    }
  }

  async replaceIdentifiers(client, employeeId, identifiers) {
    await client.query("DELETE FROM employee_identifiers WHERE employee_id=$1", [employeeId]);
    for (const item of identifiers) {
      await client.query(`INSERT INTO employee_identifiers(employee_id,identifier_type,country,masked_value,value_ciphertext,value_iv,value_auth_tag,expires_on)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [employeeId,item.identifierType,item.country,item.maskedValue,item.ciphertext,item.iv,item.authTag,nullable(item.expiresOn)]);
    }
  }

  async replaceDocuments(client, employeeId, documents, actorUserId) {
    await client.query("DELETE FROM employee_documents WHERE employee_id=$1", [employeeId]);
    for (const item of documents) {
      await client.query(`INSERT INTO employee_documents(employee_id,document_type,file_name,file_url,mime_type,size_bytes,expires_on,uploaded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [employeeId,item.documentType,item.fileName,item.fileUrl,item.mimeType,item.sizeBytes??null,nullable(item.expiresOn),actorUserId]);
    }
  }

  async addIdentifier(organizationId,employeeId,item){
    const result=await this.pool.query(`INSERT INTO employee_identifiers(employee_id,identifier_type,country,masked_value,value_ciphertext,value_iv,value_auth_tag,expires_on)
      SELECT e.id,$3,$4,$5,$6,$7,$8,$9 FROM employees e WHERE e.id=$1 AND e.organization_id=$2
      ON CONFLICT(employee_id,identifier_type,country) DO UPDATE SET masked_value=EXCLUDED.masked_value,value_ciphertext=EXCLUDED.value_ciphertext,value_iv=EXCLUDED.value_iv,value_auth_tag=EXCLUDED.value_auth_tag,expires_on=EXCLUDED.expires_on
      RETURNING id`,[employeeId,organizationId,item.identifierType,item.country,item.maskedValue,item.ciphertext,item.iv,item.authTag,nullable(item.expiresOn)]);
    return result.rows[0]||null;
  }

  async removeIdentifier(organizationId,employeeId,recordId){
    const result=await this.pool.query(`DELETE FROM employee_identifiers i USING employees e WHERE i.id=$1 AND i.employee_id=$2 AND e.id=i.employee_id AND e.organization_id=$3 RETURNING i.id`,[recordId,employeeId,organizationId]);
    return result.rowCount===1;
  }

  async addDocument(organizationId,employeeId,item,actorUserId){
    const result=await this.pool.query(`INSERT INTO employee_documents(employee_id,document_type,file_name,file_url,mime_type,size_bytes,expires_on,uploaded_by)
      SELECT e.id,$3,$4,$5,$6,$7,$8,$9 FROM employees e WHERE e.id=$1 AND e.organization_id=$2 RETURNING id`,[employeeId,organizationId,item.documentType,item.fileName,item.fileUrl,item.mimeType,item.sizeBytes??null,nullable(item.expiresOn),actorUserId]);
    return result.rows[0]||null;
  }

  async removeDocument(organizationId,employeeId,recordId){
    const result=await this.pool.query(`DELETE FROM employee_documents doc USING employees e WHERE doc.id=$1 AND doc.employee_id=$2 AND e.id=doc.employee_id AND e.organization_id=$3 RETURNING doc.id`,[recordId,employeeId,organizationId]);
    return result.rowCount===1;
  }

  async recordChange(employeeId,eventType,changes,actorUserId){
    await this.pool.query(`INSERT INTO employee_change_history(employee_id,event_type,changes,actor_user_id) VALUES($1,$2,$3,$4)`,[employeeId,eventType,changes,actorUserId]);
  }

  async insertJobHistory(client, employee, effectiveDate, reason, actorUserId) {
    const current = (await client.query(`SELECT id,effective_from AS "effectiveFrom" FROM employee_job_history WHERE employee_id=$1 AND effective_to IS NULL ORDER BY effective_from DESC LIMIT 1`, [employee.id])).rows[0];
    if (current && String(current.effectiveFrom) === String(effectiveDate)) {
      await client.query(`UPDATE employee_job_history SET department_id=$2,job_title_id=$3,work_location_id=$4,manager_employee_id=$5,employment_type=$6,work_mode=$7,reason=$8,recorded_by=$9 WHERE id=$1`,
        [current.id,employee.department_id,employee.job_title_id,employee.work_location_id,employee.manager_employee_id,employee.employment_type,employee.work_mode,reason,actorUserId]);
      return;
    }
    if (current) await client.query("UPDATE employee_job_history SET effective_to=($2::date - 1) WHERE id=$1", [current.id, effectiveDate]);
    await client.query(`INSERT INTO employee_job_history(employee_id,department_id,job_title_id,work_location_id,manager_employee_id,employment_type,work_mode,effective_from,reason,recorded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [employee.id,employee.department_id,employee.job_title_id,employee.work_location_id,employee.manager_employee_id,employee.employment_type,employee.work_mode,effectiveDate,reason,actorUserId]);
  }

  async create(organizationId, data, actorUserId) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invalidReference = await this.validateReferences(client, organizationId, data);
      if (invalidReference) { await client.query("ROLLBACK"); return {error: "reference", field: invalidReference}; }
      const fields = {
        organization_id: organizationId,
        user_id: nullable(data.userId),
        employee_number: data.employeeNumber,
        first_name: data.firstName,
        middle_name: nullable(data.middleName),
        last_name: data.lastName,
        preferred_name: nullable(data.preferredName),
        work_email: nullable(data.workEmail),
        personal_email: nullable(data.personalEmail),
        work_phone: nullable(data.workPhone),
        personal_phone: nullable(data.personalPhone),
        date_of_birth: nullable(data.dateOfBirth),
        gender: nullable(data.gender),
        pronouns: nullable(data.pronouns),
        marital_status: nullable(data.maritalStatus),
        blood_group: nullable(data.bloodGroup),
        nationality: nullable(data.nationality),
        profile_photo_url: nullable(data.profilePhotoUrl),
        biography: nullable(data.biography),
        employment_status: data.employmentStatus,
        employment_type: data.employmentType,
        work_mode: data.workMode,
        join_date: data.joinDate,
        probation_end_date: nullable(data.probationEndDate),
        confirmation_date: nullable(data.confirmationDate),
        probation_period_days: data.probationPeriodDays ?? 90,
        notice_period_days: data.noticePeriodDays ?? 30,
        benefits_eligible: data.benefitsEligible ?? false,
        department_id: nullable(data.departmentId),
        job_title_id: nullable(data.jobTitleId),
        work_location_id: nullable(data.workLocationId),
        manager_employee_id: nullable(data.managerEmployeeId),
        cost_center: nullable(data.costCenter),
        timezone: nullable(data.timezone),
        metadata: data.metadata || {},
        created_by: actorUserId,
        updated_by: actorUserId
      };
      const names = Object.keys(fields);
      const values = Object.values(fields);
      const inserted = (await client.query(`INSERT INTO employees(${names.join(",")}) VALUES(${values.map((_, index) => `$${index + 1}`).join(",")}) RETURNING *`, values)).rows[0];
      await this.replaceAddresses(client, inserted.id, data.addresses || []);
      await this.replaceEmergencyContacts(client, inserted.id, data.emergencyContacts || []);
      await this.replaceIdentifiers(client, inserted.id, data.identifiers || []);
      await this.replaceDocuments(client, inserted.id, data.documents || [], actorUserId);
      await this.insertJobHistory(client, inserted, data.joinDate, "Initial assignment", actorUserId);
      await client.query(`INSERT INTO employee_status_history(employee_id,to_status,effective_date,reason,recorded_by) VALUES($1,$2,$3,$4,$5)`, [inserted.id,data.employmentStatus,data.joinDate,"Employee record created",actorUserId]);
      await client.query(`INSERT INTO employee_change_history(employee_id,event_type,changes,actor_user_id) VALUES($1,'created',$2,$3)`, [inserted.id,{fields: Object.keys(data)},actorUserId]);
      await client.query("COMMIT");
      return this.findById(organizationId, inserted.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async update(organizationId, employeeId, data, actorUserId) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = (await client.query("SELECT * FROM employees WHERE id=$1 AND organization_id=$2 FOR UPDATE", [employeeId, organizationId])).rows[0];
      if (!current) { await client.query("ROLLBACK"); return {error: "not_found"}; }
      if (current.version !== data.version) { await client.query("ROLLBACK"); return {error: "version"}; }
      const invalidReference = await this.validateReferences(client, organizationId, data);
      if (invalidReference) { await client.query("ROLLBACK"); return {error: "reference", field: invalidReference}; }
      if (await this.managerCreatesCycle(client, organizationId, employeeId, data.managerEmployeeId)) {
        await client.query("ROLLBACK"); return {error: "manager_cycle"};
      }
      const entries = Object.entries(scalarColumns).filter(([key]) => hasOwn(data, key));
      const values = entries.map(([key]) => nullable(data[key]));
      const sets = entries.map(([, column], index) => `${column}=$${index + 1}`);
      values.push(actorUserId, employeeId, organizationId, data.version);
      const actorPosition = values.length - 3;
      const idPosition = values.length - 2;
      const organizationPosition = values.length - 1;
      const versionPosition = values.length;
      const updated = (await client.query(`UPDATE employees SET ${sets.length ? `${sets.join(",")},` : ""}updated_by=$${actorPosition},version=version+1 WHERE id=$${idPosition} AND organization_id=$${organizationPosition} AND version=$${versionPosition} RETURNING *`, values)).rows[0];
      if (hasOwn(data, "addresses")) await this.replaceAddresses(client, employeeId, data.addresses);
      if (hasOwn(data, "emergencyContacts")) await this.replaceEmergencyContacts(client, employeeId, data.emergencyContacts);
      if (hasOwn(data, "identifiers")) await this.replaceIdentifiers(client, employeeId, data.identifiers);
      if (hasOwn(data, "documents")) await this.replaceDocuments(client, employeeId, data.documents, actorUserId);
      const jobFields = ["departmentId","jobTitleId","workLocationId","managerEmployeeId","employmentType","workMode"];
      if (jobFields.some((field) => hasOwn(data, field))) {
        await this.insertJobHistory(client, updated, data.effectiveDate || new Date().toISOString().slice(0,10), nullable(data.changeReason), actorUserId);
      }
      const changedFields = Object.keys(data).filter((key) => !["version","effectiveDate","changeReason"].includes(key));
      await client.query(`INSERT INTO employee_change_history(employee_id,event_type,changes,actor_user_id) VALUES($1,'updated',$2,$3)`, [employeeId,{fields: changedFields},actorUserId]);
      await client.query("COMMIT");
      return this.findById(organizationId, employeeId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async changeStatus(organizationId, employeeId, data, actorUserId) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const employee = (await client.query("SELECT id,employment_status AS status,version FROM employees WHERE id=$1 AND organization_id=$2 FOR UPDATE", [employeeId, organizationId])).rows[0];
      if (!employee) { await client.query("ROLLBACK"); return {error: "not_found"}; }
      if (employee.version !== data.version) { await client.query("ROLLBACK"); return {error: "version"}; }
      const extras = [];
      const values = [data.status,actorUserId,employeeId,organizationId,data.version];
      if (data.status === "notice_period") { values.push(data.effectiveDate); extras.push(`notice_start_date=$${values.length}`); }
      if (data.status === "terminated") {
        values.push(data.effectiveDate); extras.push(`termination_date=$${values.length}`,`last_working_date=$${values.length}`);
        values.push(nullable(data.reason)); extras.push(`termination_reason=$${values.length}`);
      }
      if (data.status === "active" && employee.status === "probation") { values.push(data.effectiveDate); extras.push(`confirmation_date=$${values.length}`); }
      const updated = (await client.query(`UPDATE employees SET employment_status=$1,updated_by=$2,version=version+1${extras.length ? `,${extras.join(",")}` : ""} WHERE id=$3 AND organization_id=$4 AND version=$5 RETURNING id`, values)).rows[0];
      await client.query(`INSERT INTO employee_status_history(employee_id,from_status,to_status,effective_date,reason,recorded_by) VALUES($1,$2,$3,$4,$5,$6)`, [employeeId,employee.status,data.status,data.effectiveDate,nullable(data.reason),actorUserId]);
      await client.query(`INSERT INTO employee_change_history(employee_id,event_type,changes,actor_user_id) VALUES($1,'status_changed',$2,$3)`, [employeeId,{from: employee.status,to: data.status,effectiveDate: data.effectiveDate},actorUserId]);
      await client.query("COMMIT");
      return updated ? this.findById(organizationId, employeeId) : {error: "version"};
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async history(organizationId, employeeId) {
    const exists = await this.pool.query("SELECT 1 FROM employees WHERE id=$1 AND organization_id=$2", [employeeId, organizationId]);
    if (!exists.rowCount) return null;
    const [statuses, jobs, changes] = await Promise.all([
      this.pool.query(`SELECT id,from_status AS "fromStatus",to_status AS "toStatus",effective_date AS "effectiveDate",reason,created_at AS "createdAt" FROM employee_status_history WHERE employee_id=$1 ORDER BY effective_date DESC,created_at DESC`, [employeeId]),
      this.pool.query(`SELECT h.id,h.effective_from AS "effectiveFrom",h.effective_to AS "effectiveTo",h.employment_type AS "employmentType",h.work_mode AS "workMode",h.reason,d.name AS "departmentName",jt.name AS "jobTitleName",wl.name AS "workLocationName",CONCAT_WS(' ',m.first_name,m.last_name) AS "managerName" FROM employee_job_history h LEFT JOIN departments d ON d.id=h.department_id LEFT JOIN job_titles jt ON jt.id=h.job_title_id LEFT JOIN work_locations wl ON wl.id=h.work_location_id LEFT JOIN employees m ON m.id=h.manager_employee_id WHERE h.employee_id=$1 ORDER BY h.effective_from DESC`, [employeeId]),
      this.pool.query(`SELECT id,event_type AS "eventType",changes,occurred_at AS "occurredAt" FROM employee_change_history WHERE employee_id=$1 ORDER BY occurred_at DESC LIMIT 100`, [employeeId])
    ]);
    return {statuses: statuses.rows, jobs: jobs.rows, changes: changes.rows};
  }

  async nextEmployeeNumber(organizationId) {
    const result = await this.pool.query(`SELECT o.code,
      COALESCE(MAX(NULLIF(SUBSTRING(e.employee_number FROM '([0-9]+)$'), '')::int),0)+1 AS next
      FROM organizations o LEFT JOIN employees e ON e.organization_id=o.id WHERE o.id=$1 GROUP BY o.code`, [organizationId]);
    if (!result.rows[0]) return null;
    const prefix = String(result.rows[0].code).replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0,4) || "EMP";
    return `${prefix}-${String(result.rows[0].next).padStart(4,"0")}`;
  }

  async upcomingEventRows(organizationId) {
    const result = await this.pool.query(`SELECT id,employee_number AS "employeeNumber",CONCAT_WS(' ',first_name,last_name) AS name,
      date_of_birth AS "dateOfBirth",join_date AS "joinDate",probation_end_date AS "probationEndDate"
      FROM employees WHERE organization_id=$1 AND archived_at IS NULL AND employment_status<>'terminated'`, [organizationId]);
    return result.rows;
  }

  async treeRows(organizationId) {
    const result = await this.pool.query(`SELECT ${directoryColumns} FROM employees e ${employeeJoins}
      WHERE e.organization_id=$1 AND e.archived_at IS NULL AND e.employment_status<>'terminated' ORDER BY e.first_name,e.last_name`, [organizationId]);
    return result.rows;
  }

  async bulkUpdate(organizationId, data, actorUserId) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const invalidReference = await this.validateReferences(client, organizationId, data);
      if (invalidReference) { await client.query("ROLLBACK"); return {error:"reference",field:invalidReference}; }
      const employees = (await client.query("SELECT * FROM employees WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL FOR UPDATE", [organizationId,data.employeeIds])).rows;
      if (employees.length !== data.employeeIds.length) { await client.query("ROLLBACK"); return {error:"not_found"}; }
      if (data.managerEmployeeId && data.employeeIds.includes(data.managerEmployeeId)) { await client.query("ROLLBACK"); return {error:"manager_cycle"}; }
      for (const employee of employees) {
        if (await this.managerCreatesCycle(client,organizationId,employee.id,data.managerEmployeeId)) { await client.query("ROLLBACK"); return {error:"manager_cycle"}; }
      }
      const allowed = ["departmentId","jobTitleId","workLocationId","managerEmployeeId","employmentType","workMode"];
      const entries = allowed.filter((key)=>hasOwn(data,key)).map((key)=>[key,scalarColumns[key]]);
      const values = entries.map(([key])=>nullable(data[key]));
      values.push(actorUserId,organizationId,data.employeeIds);
      const actorPosition=values.length-2,organizationPosition=values.length-1,idsPosition=values.length;
      const sets=entries.map(([,column],index)=>`${column}=$${index+1}`);
      await client.query(`UPDATE employees SET ${sets.join(",")},updated_by=$${actorPosition},version=version+1 WHERE organization_id=$${organizationPosition} AND id=ANY($${idsPosition}::uuid[])`,values);
      const updated=(await client.query("SELECT * FROM employees WHERE organization_id=$1 AND id=ANY($2::uuid[])",[organizationId,data.employeeIds])).rows;
      for(const employee of updated){
        await this.insertJobHistory(client,employee,data.effectiveDate,data.changeReason,actorUserId);
        await client.query(`INSERT INTO employee_change_history(employee_id,event_type,changes,actor_user_id) VALUES($1,'bulk_updated',$2,$3)`,[employee.id,{fields:entries.map(([key])=>key),reason:data.changeReason},actorUserId]);
      }
      await client.query("COMMIT");
      return {updated:updated.length};
    } catch(error){await client.query("ROLLBACK");throw error;} finally{client.release();}
  }

  async setArchived(organizationId,employeeId,data,actorUserId,restore=false){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const employee=(await client.query("SELECT id,user_id AS \"userId\",version,archived_at AS \"archivedAt\" FROM employees WHERE id=$1 AND organization_id=$2 FOR UPDATE",[employeeId,organizationId])).rows[0];
      if(!employee){await client.query("ROLLBACK");return{error:"not_found"};}
      if(employee.version!==data.version){await client.query("ROLLBACK");return{error:"version"};}
      if(Boolean(employee.archivedAt)===!restore){await client.query("ROLLBACK");return{error:restore?"not_archived":"archived"};}
      await client.query(`UPDATE employees SET archived_at=${restore?"NULL":"NOW()"},archived_by=$3,updated_by=$3,version=version+1 WHERE id=$1 AND organization_id=$2`,[employeeId,organizationId,actorUserId]);
      if(employee.userId)await client.query("UPDATE organization_memberships SET status=$3 WHERE organization_id=$1 AND user_id=$2",[organizationId,employee.userId,restore?"active":"inactive"]);
      await client.query(`INSERT INTO employee_change_history(employee_id,event_type,changes,actor_user_id) VALUES($1,$2,$3,$4)`,[employeeId,restore?"restored":"archived",{reason:data.reason},actorUserId]);
      await client.query("COMMIT");return this.findById(organizationId,employeeId);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }

  async exportRows(organizationId, query) {
    const {values, clause} = this.filters(organizationId, query);
    const result = await this.pool.query(`SELECT e.employee_number AS "employeeNumber",CONCAT_WS(' ',e.first_name,e.last_name) AS name,e.work_email AS "workEmail",e.work_phone AS "workPhone",e.employment_status AS "employmentStatus",e.employment_type AS "employmentType",e.join_date AS "joinDate",d.name AS department,jt.name AS "jobTitle",wl.name AS location,CONCAT_WS(' ',manager.first_name,manager.last_name) AS manager FROM employees e ${employeeJoins} ${clause} ORDER BY e.first_name,e.last_name`, values);
    return result.rows;
  }
}

module.exports = {EmployeeRepository};
