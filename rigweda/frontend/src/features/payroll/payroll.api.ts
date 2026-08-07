import {apiClient} from "../../api/client";
export type Page<T>={items:T[];total:number;page:number;pageSize:number;totalPages:number};
export type PayrollSchedule={id:string;code:string;name:string;payFrequency:"monthly"|"semi_monthly"|"biweekly"|"weekly";payDay:number;cutoffDay:number;timezone:string;isDefault:boolean;status:"active"|"inactive";version:number};
export type PayrollComponent={id:string;code:string;name:string;componentType:"earning"|"deduction"|"employer_contribution"|"reimbursement";calculationMethod:"fixed"|"percent_of_basic"|"percent_of_gross"|"manual";defaultValue:number;taxable:boolean;affectsGross:boolean;affectsNet:boolean;displayOrder:number;status:"active"|"inactive";version:number};
export type Compensation={id:string;employeeId:string;employeeNumber:string;employeeName:string;payrollScheduleId:string|null;scheduleName:string|null;effectiveFrom:string;effectiveTo:string|null;currency:string;annualCtc:number;monthlyBasic:number;monthlyHra:number;monthlySpecial:number;pfEnabled:boolean;esiEnabled:boolean;professionalTaxMonthly:number;incomeTaxMonthly:number;paymentMode:"bank_transfer"|"cheque"|"cash"|"upi";status:"active"|"inactive";version:number};
export type PayrollAdjustment={id:string;employeeId:string;employeeNumber:string;employeeName:string;componentId:string|null;componentName:string|null;periodStart:string;periodEnd:string;adjustmentType:"earning"|"deduction";amount:number;reason:string;status:"pending"|"approved"|"rejected"|"applied"|"cancelled";reviewerComment:string|null;reviewerName:string|null;reviewedAt:string|null;version:number;createdAt:string};
export type PayrollRun={id:string;payrollScheduleId:string|null;scheduleName:string|null;name:string;periodStart:string;periodEnd:string;payDate:string;currency:string;status:"draft"|"computed"|"approved"|"finalized"|"reopened"|"voided";employeeCount:number;grossEarnings:number;totalDeductions:number;employerContributions:number;netPay:number;approvedByName:string|null;approvedAt:string|null;finalizedByName:string|null;finalizedAt:string|null;version:number;createdAt:string;updatedAt:string};
export type PayrollItem={id:string;payrollRunId:string;employeeId:string;employeeNumber:string;employeeName:string;departmentName:string|null;payableDays:number;lopDays:number;grossEarnings:number;totalDeductions:number;employerContributions:number;netPay:number;status:"computed"|"held"|"finalized";holdReason:string|null;version:number;components?:Array<{id:string;code:string;name:string;componentType:string;amount:number;taxable:boolean;displayOrder:number}>};
export type PayrollFilters={dateFrom:string;dateTo:string;status?:string;search?:string;employeeId?:string;page?:number};
const download=async(runId:string)=>{const response=await apiClient.get(`/payroll/runs/${runId}/export`,{responseType:"blob"});const url=URL.createObjectURL(response.data),link=document.createElement("a");link.href=url;link.download=`payroll-${runId}.csv`;link.click();URL.revokeObjectURL(url);};
export const payrollApi={
  metadata:async(search="")=>(await apiClient.get("/payroll/metadata",{params:{search}})).data.data as {employee:{id:string;employeeNumber:string;name:string}|null;employees:Array<{id:string;employeeNumber:string;name:string}>;schedules:PayrollSchedule[];components:PayrollComponent[]},
  schedules:async(search="",status="all")=>(await apiClient.get("/payroll/schedules",{params:{search,status,pageSize:100}})).data.data as Page<PayrollSchedule>,
  createSchedule:async(data:Record<string,unknown>)=>(await apiClient.post("/payroll/schedules",data)).data.data as PayrollSchedule,
  updateSchedule:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/payroll/schedules/${id}`,data)).data.data as PayrollSchedule,
  components:async(search="",status="all")=>(await apiClient.get("/payroll/components",{params:{search,status,pageSize:100}})).data.data as Page<PayrollComponent>,
  createComponent:async(data:Record<string,unknown>)=>(await apiClient.post("/payroll/components",data)).data.data as PayrollComponent,
  updateComponent:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/payroll/components/${id}`,data)).data.data as PayrollComponent,
  compensations:async(search="",status="all",employeeId="")=>(await apiClient.get("/payroll/compensations",{params:{search,status,employeeId,pageSize:100}})).data.data as Page<Compensation>,
  createCompensation:async(data:Record<string,unknown>)=>(await apiClient.post("/payroll/compensations",data)).data.data as Compensation,
  updateCompensation:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/payroll/compensations/${id}`,data)).data.data as Compensation,
  adjustments:async(params:PayrollFilters)=>(await apiClient.get("/payroll/adjustments",{params:{...params,pageSize:100}})).data.data as Page<PayrollAdjustment>,
  createAdjustment:async(data:Record<string,unknown>)=>(await apiClient.post("/payroll/adjustments",data)).data.data,
  reviewAdjustment:async(id:string,data:{decision:"approved"|"rejected"|"cancelled";comment:string|null;version:number})=>(await apiClient.post(`/payroll/adjustments/${id}/review`,data)).data.data,
  runs:async(params:PayrollFilters)=>(await apiClient.get("/payroll/runs",{params:{...params,pageSize:100}})).data.data as Page<PayrollRun>,
  createRun:async(data:Record<string,unknown>)=>(await apiClient.post("/payroll/runs",data)).data.data as PayrollRun,
  runItems:async(runId:string,search="")=>(await apiClient.get(`/payroll/runs/${runId}/items`,{params:{search,pageSize:100}})).data.data as Page<PayrollItem>,
  compute:async(runId:string)=>(await apiClient.post(`/payroll/runs/${runId}/compute`)).data.data as PayrollRun,
  approve:async(run:PayrollRun,comment="")=>(await apiClient.post(`/payroll/runs/${run.id}/approve`,{version:run.version,comment:comment||null})).data.data as PayrollRun,
  finalize:async(run:PayrollRun,comment="")=>(await apiClient.post(`/payroll/runs/${run.id}/finalize`,{version:run.version,comment:comment||null})).data.data as PayrollRun,
  reopen:async(run:PayrollRun,comment="")=>(await apiClient.post(`/payroll/runs/${run.id}/reopen`,{version:run.version,comment:comment||"Reopened for correction"})).data.data as PayrollRun,
  voidRun:async(run:PayrollRun,comment="")=>(await apiClient.post(`/payroll/runs/${run.id}/void`,{version:run.version,comment:comment||"Voided by payroll admin"})).data.data as PayrollRun,
  exportCsv:download,
  myPayslips:async(params:PayrollFilters)=>(await apiClient.get("/payroll/me/payslips",{params:{...params,pageSize:100}})).data.data as Page<PayrollRun>,
  myPayslipItems:async(runId:string)=>(await apiClient.get(`/payroll/me/payslips/${runId}/items`)).data.data as Page<PayrollItem>,
  payslipItem:async(itemId:string)=>(await apiClient.get(`/payroll/me/payslip-items/${itemId}`)).data.data as PayrollItem
};
