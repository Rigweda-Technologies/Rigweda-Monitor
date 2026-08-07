const {AppError}=require("../../lib/app-error");
const csvCell=value=>{const raw=value==null?"":String(value),safe=/^[=+\-@]/.test(raw)?`'${raw}`:raw;return `"${safe.replaceAll('"','""')}"`;};

class LeaveService{
  constructor(repository){this.repository=repository;}
  paged(result,query){return {...result,page:query.page,pageSize:query.pageSize,totalPages:Math.ceil(result.total/query.pageSize)};}
  assertRange(dateFrom,dateTo,maxDays=366){const start=new Date(`${dateFrom}T00:00:00Z`),end=new Date(`${dateTo}T00:00:00Z`),days=(end-start)/86400000;if(end<start)throw new AppError(422,"INVALID_DATE_RANGE","The end date must be on or after the start date.");if(days>maxDays)throw new AppError(422,"DATE_RANGE_TOO_LARGE",`The requested date range cannot exceed ${maxDays} days.`);}
  metadata(org,user,search){return this.repository.metadata(org,user,search);}
  async mySummary(org,user,year){const result=await this.repository.mySummary(org,user,year);if(!result)throw new AppError(404,"EMPLOYEE_PROFILE_REQUIRED","Your login is not linked to an employee profile.");return result;}
  async myBalances(org,user,year){const result=await this.repository.balancesForUser(org,user,year);if(!result)throw new AppError(404,"EMPLOYEE_PROFILE_REQUIRED","Your login is not linked to an employee profile.");return result;}
  async myRequests(org,user,query){return this.paged(await this.repository.listRequests(org,query,user),query);}
  async requests(org,query){if(query.dateFrom&&query.dateTo)this.assertRange(query.dateFrom,query.dateTo);return this.paged(await this.repository.listRequests(org,query),query);}
  async request(org,id){const result=await this.repository.findRequest(org,id);if(!result)throw new AppError(404,"LEAVE_REQUEST_NOT_FOUND","Leave request not found.");return result;}
  async createRequest(org,user,data){
    if(new Date(data.endDate)<new Date(data.startDate))throw new AppError(422,"INVALID_DATE_RANGE","Leave end date must be on or after its start date.");
    this.assertRange(data.startDate,data.endDate);
    if(data.startDate===data.endDate&&data.startSession!=="full_day"&&data.endSession!=="full_day"&&data.startSession!==data.endSession)throw new AppError(422,"INVALID_LEAVE_SESSION","A single-day request cannot use two different half-day sessions.");
    const result=await this.repository.createRequest(org,user,data);
    const errors={employee:[404,"EMPLOYEE_PROFILE_REQUIRED","Your login is not linked to an employee profile."],type:[422,"LEAVE_TYPE_UNAVAILABLE","The selected leave type is not available."],notice:[422,"LEAVE_NOTICE_REQUIRED",`This leave type requires ${result?.minimum||0} days of advance notice.`],half_day:[422,"HALF_DAY_NOT_ALLOWED","The selected leave type does not allow half-day requests."],handover:[422,"INVALID_HANDOVER_EMPLOYEE","The handover employee is unavailable in this organization."],no_working_days:[422,"NO_WORKING_DAYS","The selected range contains no working days."],maximum:[422,"LEAVE_DURATION_EXCEEDED",`This leave type allows at most ${result?.maximum||0} consecutive days.`],attachment:[422,"LEAVE_ATTACHMENT_REQUIRED",`An attachment is required for requests of ${result?.threshold||0} days or more.`],overlap:[409,"LEAVE_REQUEST_OVERLAP","An active leave request already covers one or more selected working days."],balance:[422,"INSUFFICIENT_LEAVE_BALANCE",`Insufficient balance for ${result?.year||"the selected period"}. Available: ${result?.available||0}; required: ${result?.required||0}.`]};
    if(result?.error){const [status,code,message]=errors[result.error]||[422,"LEAVE_REQUEST_INVALID","The leave request could not be submitted."];throw new AppError(status,code,message);}
    return result;
  }
  async review(org,id,data,user){return this.resolveAction(await this.repository.reviewRequest(org,id,data,user));}
  async cancel(org,user,id,data){return this.resolveAction(await this.repository.cancelRequest(org,user,id,data));}
  async reviewCancellation(org,id,data,user){return this.resolveAction(await this.repository.reviewCancellation(org,id,data,user));}
  resolveAction(result){if(result?.error==="employee")throw new AppError(404,"EMPLOYEE_PROFILE_REQUIRED","Your login is not linked to an employee profile.");if(result?.error==="not_found")throw new AppError(404,"LEAVE_REQUEST_NOT_FOUND","Leave request not found.");if(result?.error==="version")throw new AppError(409,"VERSION_CONFLICT","This leave request changed. Refresh and try again.");if(result?.error==="state")throw new AppError(409,"LEAVE_REQUEST_STATE_CHANGED","This leave request is no longer in the required state.");return result;}
  async types(org,query){return this.paged(await this.repository.listTypes(org,query),query);}
  type(org,id){return this.repository.findType(org,id).then(result=>{if(!result)throw new AppError(404,"LEAVE_TYPE_NOT_FOUND","Leave type not found.");return result;});}
  async createType(org,data,user){try{return await this.repository.createType(org,data,user);}catch(error){if(error.code==="23505")throw new AppError(409,"LEAVE_TYPE_CONFLICT","A leave type with this code or name already exists.");throw error;}}
  async updateType(org,id,data,user){try{const result=await this.repository.updateType(org,id,data,user);if(!result){await this.type(org,id);throw new AppError(409,"VERSION_CONFLICT","This leave type changed. Refresh and try again.");}return result;}catch(error){if(error.code==="23505")throw new AppError(409,"LEAVE_TYPE_CONFLICT","A leave type with this code or name already exists.");throw error;}}
  async balances(org,query){return this.paged(await this.repository.listBalances(org,query),query);}
  async adjustBalance(org,data,user){const result=await this.repository.adjustBalance(org,data,user);if(result?.error==="reference")throw new AppError(422,"INVALID_BALANCE_REFERENCE","The employee or leave type is unavailable in this organization.");if(result?.error==="balance")throw new AppError(422,"INVALID_BALANCE_ADJUSTMENT",`The adjustment would exceed the allowed negative balance. Available: ${result.available}.`);return result;}
  async calendars(org,query){return this.paged(await this.repository.listCalendars(org,query),query);}
  async createCalendar(org,data,user){try{const result=await this.repository.createCalendar(org,data,user);if(result?.error)throw new AppError(422,"INVALID_CALENDAR_LOCATION","A selected work location is unavailable in this organization.");return result;}catch(error){if(error.code==="23505")throw new AppError(409,"HOLIDAY_CALENDAR_CONFLICT","A calendar name or work-location assignment already exists.");throw error;}}
  async updateCalendar(org,id,data,user){try{const result=await this.repository.updateCalendar(org,id,data,user);if(result?.error)throw new AppError(422,"INVALID_CALENDAR_LOCATION","A selected work location is unavailable in this organization.");if(!result)throw new AppError(409,"VERSION_CONFLICT","This holiday calendar changed. Refresh and try again.");return result;}catch(error){if(error.code==="23505")throw new AppError(409,"HOLIDAY_CALENDAR_CONFLICT","A calendar name or work-location assignment already exists.");throw error;}}
  async holidays(org,query){if(query.dateFrom&&query.dateTo)this.assertRange(query.dateFrom,query.dateTo,730);return this.paged(await this.repository.listHolidays(org,query),query);}
  async createHoliday(org,data,user){try{const result=await this.repository.createHoliday(org,data,user);if(result?.error)throw new AppError(422,"INVALID_HOLIDAY_CALENDAR","The selected holiday calendar is unavailable.");return result;}catch(error){if(error.code==="23505")throw new AppError(409,"HOLIDAY_CONFLICT","This holiday already exists in the selected calendar.");throw error;}}
  async updateHoliday(org,id,data,user){try{const result=await this.repository.updateHoliday(org,id,data,user);if(!result)throw new AppError(409,"VERSION_CONFLICT","This holiday changed or no longer exists.");return result;}catch(error){if(error.code==="23505")throw new AppError(409,"HOLIDAY_CONFLICT","This holiday already exists in the selected calendar.");throw error;}}
  async teamCalendar(org,query){this.assertRange(query.dateFrom,query.dateTo,92);return this.paged(await this.repository.teamCalendar(org,query),query);}
  async reportSummary(org,query){this.assertRange(query.dateFrom,query.dateTo,366);return this.repository.reportSummary(org,query);}
  async export(org,query){
    this.assertRange(query.dateFrom,query.dateTo,366);const items=[];let page=1,total=0;
    do{const result=await this.repository.listRequests(org,{...query,page,pageSize:500});items.push(...result.items);total=result.total;if(total>50000)throw new AppError(422,"EXPORT_TOO_LARGE","Narrow the export filters to 50,000 leave requests or fewer.");page+=1;}while(items.length<total);
    const rows=[["Employee Number","Employee","Leave Type","Start Date","End Date","Days","Status","Reason","Submitted At"],...items.map(item=>[item.employeeNumber,item.employeeName,item.leaveTypeName,item.startDate,item.endDate,item.requestedDays,item.status,item.reason,item.submittedAt])];return rows.map(row=>row.map(csvCell).join(",")).join("\n");
  }
}

module.exports={LeaveService};
