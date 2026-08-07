const {AppError}=require("../../lib/app-error");
const csvCell=value=>{const raw=value==null?"":String(value);const safe=/^[=+\-@]/.test(raw)?`'${raw}`:raw;return `"${safe.replaceAll('"','""')}"`;};
const daysBetween=(from,to)=>Math.floor((new Date(`${to}T00:00:00Z`)-new Date(`${from}T00:00:00Z`))/86400000);

class PayrollService{
  constructor(repository){this.repository=repository;}
  paged(result,query){return {...result,page:query.page,pageSize:query.pageSize,totalPages:Math.ceil(result.total/query.pageSize)};}
  assertRange(from,to,maxDays=370){if(new Date(from)>new Date(to))throw new AppError(422,"INVALID_DATE_RANGE","The end date must be on or after the start date.");if(daysBetween(from,to)>maxDays)throw new AppError(422,"DATE_RANGE_TOO_LARGE",`Select a range of ${maxDays} days or less.`);}
  metadata(org,user,search){return this.repository.metadata(org,user,search);}
  schedules(org,query){return this.repository.schedules(org,query).then(result=>this.paged(result,query));}
  components(org,query){return this.repository.components(org,query).then(result=>this.paged(result,query));}
  async createSchedule(org,data,user){try{return await this.repository.createSchedule(org,data,user);}catch(error){if(error.code==="23505")throw new AppError(409,"PAYROLL_SCHEDULE_CONFLICT","A payroll schedule with this code or name already exists.");throw error;}}
  async updateSchedule(org,id,data,user){try{const result=await this.repository.updateSchedule(org,id,data,user);if(!result)throw new AppError(409,"VERSION_CONFLICT","This schedule changed. Refresh and try again.");return result;}catch(error){if(error.code==="23505")throw new AppError(409,"PAYROLL_SCHEDULE_CONFLICT","A payroll schedule with this code or name already exists.");throw error;}}
  async createComponent(org,data,user){try{return await this.repository.createComponent(org,data,user);}catch(error){if(error.code==="23505")throw new AppError(409,"PAYROLL_COMPONENT_CONFLICT","A payroll component with this code or name already exists.");throw error;}}
  async updateComponent(org,id,data,user){try{const result=await this.repository.updateComponent(org,id,data,user);if(!result)throw new AppError(409,"VERSION_CONFLICT","This component changed. Refresh and try again.");return result;}catch(error){if(error.code==="23505")throw new AppError(409,"PAYROLL_COMPONENT_CONFLICT","A payroll component with this code or name already exists.");throw error;}}
  compensations(org,query){return this.repository.listCompensations(org,query).then(result=>this.paged(result,query));}
  async createCompensation(org,data,user){this.assertEffectiveDates(data);const result=await this.repository.createCompensation(org,data,user);if(result?.error==="reference")throw new AppError(422,"INVALID_COMPENSATION_REFERENCE","The employee or payroll schedule is unavailable.");return result;}
  async updateCompensation(org,id,data,user){this.assertEffectiveDates(data);const result=await this.repository.updateCompensation(org,id,data,user);if(!result)throw new AppError(409,"VERSION_CONFLICT","This compensation record changed. Refresh and try again.");return result;}
  assertEffectiveDates(data){if(data.effectiveFrom&&data.effectiveTo&&new Date(data.effectiveTo)<new Date(data.effectiveFrom))throw new AppError(422,"INVALID_DATE_RANGE","Effective end date must follow the start date.");}
  adjustments(org,query){if(query.dateFrom&&query.dateTo)this.assertRange(query.dateFrom,query.dateTo);return this.repository.listAdjustments(org,query).then(result=>this.paged(result,query));}
  async createAdjustment(org,data,user){this.assertRange(data.periodStart,data.periodEnd);const result=await this.repository.createAdjustment(org,data,user);if(result?.error==="reference")throw new AppError(422,"INVALID_ADJUSTMENT_REFERENCE","The employee or component is unavailable.");return result;}
  async reviewAdjustment(org,id,data,user){const result=await this.repository.reviewAdjustment(org,id,data,user);if(!result)throw new AppError(409,"PAYROLL_ADJUSTMENT_NOT_REVIEWABLE","This adjustment changed or is no longer pending.");return result;}
  runs(org,query){this.assertRange(query.dateFrom,query.dateTo,740);return this.repository.listRuns(org,query).then(result=>this.paged(result,query));}
  myPayslips(org,user,query){this.assertRange(query.dateFrom,query.dateTo,740);return this.repository.listRuns(org,{...query,status:query.status==="all"?"finalized":query.status},user).then(result=>this.paged(result,query));}
  async createRun(org,data,user){this.assertRange(data.periodStart,data.periodEnd,62);try{return await this.repository.createRun(org,data,user);}catch(error){if(error.code==="23505")throw new AppError(409,"PAYROLL_RUN_CONFLICT","A payroll run already exists for this schedule and period.");throw error;}}
  async run(org,id){const result=await this.repository.findRun(org,id);if(!result)throw new AppError(404,"PAYROLL_RUN_NOT_FOUND","Payroll run not found.");return result;}
  async items(org,id,query){await this.run(org,id);return this.paged(await this.repository.listRunItems(org,id,query),query);}
  async myItems(org,user,id,query){await this.run(org,id);return this.paged(await this.repository.listRunItems(org,id,query,user),query);}
  async payslip(org,user,itemId){const result=await this.repository.findRunItem(org,itemId,user);if(!result)throw new AppError(404,"PAYSLIP_NOT_FOUND","Payslip not found.");if(result.runStatus!=="finalized")throw new AppError(404,"PAYSLIP_NOT_AVAILABLE","Payslip is available only after payroll is finalized.");return result;}
  async item(org,itemId){const result=await this.repository.findRunItem(org,itemId);if(!result)throw new AppError(404,"PAYROLL_ITEM_NOT_FOUND","Payroll item not found.");return result;}
  async compute(org,id,user){const result=await this.repository.computeRun(org,id,user);this.resolveRun(result);return result;}
  async approve(org,id,data,user){const result=await this.repository.transitionRun(org,id,data.version,user,"approve");this.resolveRun(result);return result;}
  async finalize(org,id,data,user){const result=await this.repository.transitionRun(org,id,data.version,user,"finalize");this.resolveRun(result);return result;}
  async reopen(org,id,data,user){const result=await this.repository.transitionRun(org,id,data.version,user,"reopen");this.resolveRun(result);return result;}
  async void(org,id,data,user){const result=await this.repository.transitionRun(org,id,data.version,user,"void");this.resolveRun(result);return result;}
  resolveRun(result){if(result?.error==="not_found")throw new AppError(404,"PAYROLL_RUN_NOT_FOUND","Payroll run not found.");if(result?.error==="state")throw new AppError(409,"INVALID_PAYROLL_RUN_STATE","Payroll run is not in the required state.");if(result?.error==="version")throw new AppError(409,"VERSION_CONFLICT","This payroll run changed. Refresh and try again.");}
  async export(org,runId){const run=await this.run(org,runId);const items=[];let page=1,total=0;do{const result=await this.repository.listRunItems(org,runId,{page,pageSize:100,search:""});items.push(...result.items);total=result.total;if(total>50000)throw new AppError(422,"EXPORT_TOO_LARGE","Narrow the payroll export below 50,000 rows.");page+=1;}while(items.length<total);const rows=[["Run","Period","Employee Number","Employee","Department","Payable Days","LOP Days","Gross Earnings","Deductions","Employer Contributions","Net Pay","Status"],...items.map(item=>[run.name,`${run.periodStart} to ${run.periodEnd}`,item.employeeNumber,item.employeeName,item.departmentName,item.payableDays,item.lopDays,item.grossEarnings,item.totalDeductions,item.employerContributions,item.netPay,item.status])];return rows.map(row=>row.map(csvCell).join(",")).join("\n");}
}
module.exports={PayrollService};
