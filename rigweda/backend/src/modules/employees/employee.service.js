const {AppError} = require("../../lib/app-error");

const transitions = {
  preboarding: ["probation", "active", "terminated"],
  probation: ["active", "on_leave", "suspended", "terminated"],
  active: ["on_leave", "notice_period", "suspended", "terminated"],
  on_leave: ["active", "notice_period", "suspended", "terminated"],
  notice_period: ["active", "on_leave", "terminated"],
  suspended: ["active", "terminated"],
  terminated: []
};

class EmployeeService {
  constructor(repository, encryption = null) { this.repository = repository; this.encryption = encryption; }

  protectSensitive(data) {
    if (!data.identifiers) return data;
    if (!this.encryption) throw new AppError(500, "ENCRYPTION_UNAVAILABLE", "Sensitive-data encryption is unavailable.");
    return {...data, identifiers: data.identifiers.map((identifier) => ({...identifier, ...this.encryption.protect(identifier.identifierValue), identifierValue: undefined}))};
  }

  async list(organizationId, query) {
    const result = await this.repository.list(organizationId, query);
    return {...result, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(result.total / query.pageSize)};
  }

  summary(organizationId) { return this.repository.summary(organizationId); }
  metadata(organizationId) { return this.repository.metadata(organizationId); }

  async get(organizationId, employeeId) {
    const employee = await this.repository.findById(organizationId, employeeId);
    if (!employee) throw new AppError(404, "EMPLOYEE_NOT_FOUND", "Employee not found.");
    return employee;
  }

  validateDates(data) {
    const joinDate = data.joinDate ? new Date(data.joinDate) : null;
    if (data.dateOfBirth && new Date(data.dateOfBirth) >= new Date()) {
      throw new AppError(422, "DATE_INVALID", "Date of birth must be in the past.");
    }
    for (const [key, label] of [["probationEndDate","Probation end date"],["confirmationDate","Confirmation date"]]) {
      if (joinDate && data[key] && new Date(data[key]) < joinDate) {
        throw new AppError(422, "DATE_INVALID", `${label} cannot be before the join date.`);
      }
    }
    for (const [key, label] of [["addresses", "address"], ["emergencyContacts", "emergency contact"]]) {
      if (data[key] && data[key].filter((item) => item.isPrimary).length > 1) {
        throw new AppError(422, "PRIMARY_CONTACT_CONFLICT", `Only one primary ${label} is allowed.`);
      }
    }
  }

  resultError(result) {
    if (result?.error === "not_found") throw new AppError(404, "EMPLOYEE_NOT_FOUND", "Employee not found.");
    if (result?.error === "version") throw new AppError(409, "VERSION_CONFLICT", "This employee was changed by someone else. Refresh and try again.");
    if (result?.error === "reference") throw new AppError(422, "REFERENCE_INVALID", "A selected organization reference is invalid.", [{field: result.field, message: "The selected record does not belong to this organization."}]);
    if (result?.error === "manager_cycle") throw new AppError(422, "REPORTING_CYCLE", "This manager assignment would create a reporting cycle.");
    return result;
  }

  translateDatabaseError(error) {
    if (error.code === "23505") throw new AppError(409, "EMPLOYEE_CONFLICT", "The employee number, work email, or linked user is already assigned.");
    if (error.code === "23503") throw new AppError(422, "REFERENCE_INVALID", "A selected organization reference is invalid.");
    if (error.code === "23514") throw new AppError(422, "EMPLOYEE_DATA_INVALID", "Employee dates or employment data are inconsistent.");
    throw error;
  }

  async create(organizationId, data, actorUserId) {
    this.validateDates(data);
    try { return this.resultError(await this.repository.create(organizationId, this.protectSensitive(data), actorUserId)); }
    catch (error) { return this.translateDatabaseError(error); }
  }

  async update(organizationId, employeeId, data, actorUserId) {
    this.validateDates(data);
    try { return this.resultError(await this.repository.update(organizationId, employeeId, this.protectSensitive(data), actorUserId)); }
    catch (error) { return this.translateDatabaseError(error); }
  }

  async changeStatus(organizationId, employeeId, data, actorUserId) {
    const current = await this.repository.findById(organizationId, employeeId);
    if (!current) throw new AppError(404, "EMPLOYEE_NOT_FOUND", "Employee not found.");
    if (current.employmentStatus === data.status) throw new AppError(422, "STATUS_UNCHANGED", "Employee is already in this status.");
    if (!transitions[current.employmentStatus]?.includes(data.status)) {
      throw new AppError(422, "STATUS_TRANSITION_INVALID", `An employee cannot move from ${current.employmentStatus} to ${data.status}.`);
    }
    if (data.status === "terminated" && !data.reason) throw new AppError(422, "TERMINATION_REASON_REQUIRED", "A termination reason is required.");
    try { return this.resultError(await this.repository.changeStatus(organizationId, employeeId, data, actorUserId)); }
    catch (error) { return this.translateDatabaseError(error); }
  }

  async history(organizationId, employeeId) {
    const history = await this.repository.history(organizationId, employeeId);
    if (!history) throw new AppError(404, "EMPLOYEE_NOT_FOUND", "Employee not found.");
    return history;
  }

  async nextEmployeeNumber(organizationId) {
    const employeeNumber = await this.repository.nextEmployeeNumber(organizationId);
    if (!employeeNumber) throw new AppError(404,"ORGANIZATION_NOT_FOUND","Organization not found.");
    return {employeeNumber};
  }

  async myProfile(organizationId,userId){
    const employee=await this.repository.findByUserId(organizationId,userId);
    if(!employee)throw new AppError(404,"EMPLOYEE_PROFILE_NOT_FOUND","No employee profile is linked to this account.");
    return employee;
  }

  async completeMyProfile(organizationId,userId,data){
    const employee=await this.myProfile(organizationId,userId);
    this.validateDates(data);
    try{return this.resultError(await this.repository.update(organizationId,employee.id,this.protectSensitive({...data,profileCompleted:true}),userId));}
    catch(error){return this.translateDatabaseError(error);}
  }

  async updateSensitiveRecords(organizationId,employeeId,data,actorUserId){
    try{return this.resultError(await this.repository.update(organizationId,employeeId,this.protectSensitive(data),actorUserId));}
    catch(error){return this.translateDatabaseError(error);}
  }

  async addIdentifier(organizationId,employeeId,data,actorUserId){
    const protectedItem={...data,...this.encryption.protect(data.identifierValue),identifierValue:undefined};
    const result=await this.repository.addIdentifier(organizationId,employeeId,protectedItem);
    if(!result)throw new AppError(404,"EMPLOYEE_NOT_FOUND","Employee not found.");
    await this.repository.recordChange(employeeId,"identifier_updated",{identifierType:data.identifierType,country:data.country},actorUserId);
    return this.get(organizationId,employeeId);
  }

  async removeIdentifier(organizationId,employeeId,recordId,actorUserId){
    if(!await this.repository.removeIdentifier(organizationId,employeeId,recordId))throw new AppError(404,"IDENTIFIER_NOT_FOUND","Protected identifier not found.");
    await this.repository.recordChange(employeeId,"identifier_removed",{recordId},actorUserId);
  }

  async addDocument(organizationId,employeeId,data,actorUserId){
    const result=await this.repository.addDocument(organizationId,employeeId,data,actorUserId);
    if(!result)throw new AppError(404,"EMPLOYEE_NOT_FOUND","Employee not found.");
    await this.repository.recordChange(employeeId,"document_added",{documentType:data.documentType,fileName:data.fileName},actorUserId);
    return this.get(organizationId,employeeId);
  }

  async removeDocument(organizationId,employeeId,recordId,actorUserId){
    if(!await this.repository.removeDocument(organizationId,employeeId,recordId))throw new AppError(404,"DOCUMENT_NOT_FOUND","Employee document not found.");
    await this.repository.recordChange(employeeId,"document_removed",{recordId},actorUserId);
  }

  async reopenProfile(organizationId,employeeId,version,actorUserId){
    try{return this.resultError(await this.repository.update(organizationId,employeeId,{version,profileCompleted:false},actorUserId));}
    catch(error){return this.translateDatabaseError(error);}
  }

  async bulkUpdate(organizationId,data,actorUserId){
    try{return this.resultError(await this.repository.bulkUpdate(organizationId,data,actorUserId));}
    catch(error){return this.translateDatabaseError(error);}
  }

  async archive(organizationId,employeeId,data,actorUserId,restore=false){
    try{
      const result=await this.repository.setArchived(organizationId,employeeId,data,actorUserId,restore);
      if(result?.error==="archived")throw new AppError(422,"EMPLOYEE_ALREADY_ARCHIVED","Employee is already archived.");
      if(result?.error==="not_archived")throw new AppError(422,"EMPLOYEE_NOT_ARCHIVED","Employee is not archived.");
      return this.resultError(result);
    }catch(error){return this.translateDatabaseError(error);}
  }

  async organizationTree(organizationId){
    const rows=await this.repository.treeRows(organizationId);const nodes=new Map(rows.map(row=>[row.id,{...row,reports:[]}])) ;const roots=[];
    for(const node of nodes.values()){
      const manager=node.managerEmployeeId?nodes.get(node.managerEmployeeId):null;
      if(manager)manager.reports.push(node);else roots.push(node);
    }
    return roots;
  }

  async upcomingEvents(organizationId,days=45){
    const rows=await this.repository.upcomingEventRows(organizationId);const now=new Date();now.setHours(0,0,0,0);const until=new Date(now);until.setDate(until.getDate()+days);const events=[];
    const recurring=(value)=>{if(!value)return null;const source=new Date(`${value}T00:00:00`);let date=new Date(now.getFullYear(),source.getMonth(),source.getDate());if(date<now)date=new Date(now.getFullYear()+1,source.getMonth(),source.getDate());return date;};
    for(const employee of rows){
      for(const [type,value] of [["birthday",employee.dateOfBirth],["work_anniversary",employee.joinDate]]){const date=recurring(value);if(date&&date<=until)events.push({type,date:date.toISOString().slice(0,10),employeeId:employee.id,employeeNumber:employee.employeeNumber,name:employee.name});}
      if(employee.probationEndDate){const date=new Date(`${employee.probationEndDate}T00:00:00`);if(date>=now&&date<=until)events.push({type:"probation_completion",date:employee.probationEndDate,employeeId:employee.id,employeeNumber:employee.employeeNumber,name:employee.name});}
    }
    return events.sort((a,b)=>a.date.localeCompare(b.date));
  }

  async exportCsv(organizationId, query) {
    const rows = await this.repository.exportRows(organizationId, query);
    const columns = [
      ["Employee number","employeeNumber"], ["Name","name"], ["Work email","workEmail"],
      ["Work phone","workPhone"], ["Status","employmentStatus"], ["Employment type","employmentType"],
      ["Join date","joinDate"], ["Department","department"], ["Job title","jobTitle"],
      ["Location","location"], ["Manager","manager"]
    ];
    const cell = (value) => {
      let text = value == null ? "" : String(value);
      if (/^[=+\-@]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    return [columns.map(([label]) => cell(label)).join(","), ...rows.map((row) => columns.map(([,key]) => cell(row[key])).join(","))].join("\r\n");
  }
}

module.exports = {EmployeeService, transitions};
