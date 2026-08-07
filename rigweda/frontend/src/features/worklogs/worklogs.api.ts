import {apiClient} from "../../api/client";

export type Page<T>={items:T[];total:number;page:number;pageSize:number;totalPages:number};
export type WorkClient={id:string;code:string;name:string;description:string|null;contactName:string|null;contactEmail:string|null;billingCurrency:string;status:"active"|"inactive";version:number;projectCount?:number};
export type WorkProject={id:string;clientId:string|null;clientName:string|null;code:string;name:string;description:string|null;projectType:"internal"|"client"|"support"|"research"|"operations";isBillable:boolean;defaultBillRate:number|null;currency:string;startDate:string|null;endDate:string|null;status:"active"|"on_hold"|"completed"|"inactive";version:number;memberCount?:number;trackedMinutes?:number};
export type WorkEntry={id:string;employeeId:string;employeeNumber:string;employeeName:string;projectId:string|null;projectName:string|null;projectCode:string|null;clientId:string|null;clientName:string|null;workDate:string;taskTitle:string;description:string|null;minutes:number;isBillable:boolean;workLocation:string|null;status:"draft"|"submitted"|"approved"|"rejected"|"voided";timesheetId:string|null;version:number;createdAt:string;updatedAt:string};
export type Timesheet={id:string;employeeId:string;employeeNumber:string;employeeName:string;periodStart:string;periodEnd:string;status:"submitted"|"approved"|"rejected"|"reopened";totalMinutes:number;billableMinutes:number;submittedAt:string;reviewerName:string|null;reviewerComment:string|null;reviewedAt:string|null;version:number;entryCount?:number;entries?:WorkEntry[]};
export type ProjectAssignment={id:string;projectId:string;projectName:string;employeeId:string;employeeNumber:string;employeeName:string;projectRole:string|null;allocationPercent:number;effectiveFrom:string;effectiveTo:string|null;status:"active"|"inactive";version:number};
export type WorkReport={projectId:string|null;projectName:string;clientName:string|null;status:string;entryCount:number;totalMinutes:number;billableMinutes:number;employeeCount:number};
export type WorkFilters={dateFrom:string;dateTo:string;search?:string;status?:string;employeeId?:string;projectId?:string;clientId?:string;billable?:boolean;page?:number};
const download=async(params:WorkFilters)=>{const response=await apiClient.get("/work-logs/entries/export",{params,responseType:"blob"});const url=URL.createObjectURL(response.data),link=document.createElement("a");link.href=url;link.download=`work-logs-${params.dateFrom}-${params.dateTo}.csv`;link.click();URL.revokeObjectURL(url);};

export const worklogsApi={
  metadata:async(search="")=>(await apiClient.get("/work-logs/metadata",{params:{search}})).data.data as {employee:{id:string;employeeNumber:string;name:string}|null;projects:Array<{id:string;code:string;name:string;isBillable:boolean;currency:string;clientName:string|null}>;employees:Array<{id:string;employeeNumber:string;name:string}>;clients:Array<{id:string;code:string;name:string;billingCurrency:string}>},
  myEntries:async(params:WorkFilters)=>(await apiClient.get("/work-logs/me/entries",{params:{...params,pageSize:100}})).data.data as Page<WorkEntry>,
  entries:async(params:WorkFilters)=>(await apiClient.get("/work-logs/entries",{params:{...params,pageSize:100}})).data.data as Page<WorkEntry>,
  createEntry:async(data:Record<string,unknown>)=>(await apiClient.post("/work-logs/me/entries",data)).data.data as WorkEntry,
  updateEntry:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/work-logs/me/entries/${id}`,data)).data.data as WorkEntry,
  voidEntry:async(id:string,data:{version:number;reason:string})=>(await apiClient.post(`/work-logs/me/entries/${id}/void`,data)).data.data as WorkEntry,
  submit:async(data:{periodStart:string;periodEnd:string;notes?:string|null})=>(await apiClient.post("/work-logs/me/timesheets/submit",data)).data.data as Timesheet,
  myTimesheets:async(params:WorkFilters)=>(await apiClient.get("/work-logs/me/timesheets",{params:{...params,pageSize:100}})).data.data as Page<Timesheet>,
  timesheets:async(params:WorkFilters)=>(await apiClient.get("/work-logs/timesheets",{params:{...params,pageSize:100}})).data.data as Page<Timesheet>,
  timesheet:async(id:string)=>(await apiClient.get(`/work-logs/timesheets/${id}`)).data.data as Timesheet,
  review:async(id:string,data:{decision:"approved"|"rejected";comment:string|null;version:number})=>(await apiClient.post(`/work-logs/timesheets/${id}/review`,data)).data.data as Timesheet,
  reopen:async(id:string,data:{comment:string;version:number})=>(await apiClient.post(`/work-logs/timesheets/${id}/reopen`,data)).data.data as Timesheet,
  clients:async(search="",status="all")=>(await apiClient.get("/work-logs/clients",{params:{search,status,pageSize:100}})).data.data as Page<WorkClient>,
  createClient:async(data:Record<string,unknown>)=>(await apiClient.post("/work-logs/clients",data)).data.data as WorkClient,
  updateClient:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/work-logs/clients/${id}`,data)).data.data as WorkClient,
  projects:async(search="",status="all",clientId="")=>(await apiClient.get("/work-logs/projects",{params:{search,status,clientId,pageSize:100}})).data.data as Page<WorkProject>,
  createProject:async(data:Record<string,unknown>)=>(await apiClient.post("/work-logs/projects",data)).data.data as WorkProject,
  updateProject:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/work-logs/projects/${id}`,data)).data.data as WorkProject,
  assignments:async(search="",projectId="")=>(await apiClient.get("/work-logs/assignments",{params:{search,projectId,pageSize:100}})).data.data as Page<ProjectAssignment>,
  createAssignment:async(data:Record<string,unknown>)=>(await apiClient.post("/work-logs/assignments",data)).data.data,
  updateAssignment:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/work-logs/assignments/${id}`,data)).data.data,
  report:async(params:WorkFilters)=>(await apiClient.get("/work-logs/entries/report",{params:{...params,pageSize:100}})).data.data as {items:WorkReport[]},
  exportCsv:download
};
