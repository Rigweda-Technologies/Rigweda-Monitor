import {apiClient} from "../../api/client";

export type LeaveStatus="draft"|"pending"|"approved"|"rejected"|"cancel_requested"|"cancelled"|"withdrawn";
export type LeaveType={id:string;code:string;name:string;description:string|null;color:string;annualEntitlementDays:number;isPaid:boolean;requiresApproval:boolean;allowHalfDay:boolean;allowNegativeBalance:boolean;maximumNegativeDays:number;minimumNoticeDays:number;maximumConsecutiveDays:number|null;attachmentRequiredAfterDays:number|null;carryForwardAllowed:boolean;maximumCarryForwardDays:number;encashmentAllowed:boolean;status:"active"|"inactive";version:number;activeRequestCount?:number};
export type LeaveBalance={accountId?:string;employeeId?:string;employeeNumber?:string;employeeName?:string;leaveTypeId:string;leaveTypeCode:string;leaveTypeName:string;leaveTypeColor?:string;color?:string;entitlement?:number;openingDays:number;accruedDays:number;adjustedDays:number;carriedForwardDays:number;usedDays:number;pendingDays:number;encashedDays:number;available:number;version?:number};
export type LeaveRequest={id:string;employeeId:string;employeeNumber:string;employeeName:string;leaveTypeId:string;leaveTypeCode:string;leaveTypeName:string;leaveTypeColor:string;startDate:string;endDate:string;startSession:string;endSession:string;requestedDays:number;reason:string;emergencyContact:string|null;handoverEmployeeId:string|null;handoverEmployeeName:string|null;attachmentName:string|null;attachmentUrl:string|null;status:LeaveStatus;submittedAt:string|null;reviewerName:string|null;reviewerComment:string|null;reviewedAt:string|null;cancellationReason:string|null;cancellationReviewerName:string|null;cancellationComment:string|null;cancellationReviewedAt:string|null;version:number;createdAt:string;days?:Array<{date:string;fraction:number;session:string}>;history?:Array<{id:number;eventType:string;actorName:string|null;occurredAt:string}>};
export type HolidayCalendar={id:string;name:string;description:string|null;timezone:string;isDefault:boolean;status:"active"|"inactive";version:number;holidayCount?:number;locations?:Array<{id:string;name:string}>;locationIds?:string[]};
export type Holiday={id:string;calendarId:string;calendarName:string;name:string;holidayDate:string;isOptional:boolean;description:string|null;version:number};
export type TeamLeave={requestId:string;date:string;fraction:number;session:string;employeeId:string;employeeNumber:string;employeeName:string;departmentName:string|null;leaveTypeId:string;leaveTypeName:string;color:string};
type Page<T>={items:T[];total:number;page:number;pageSize:number;totalPages:number};
type RequestFilters={status?:string;search?:string;leaveTypeId?:string;employeeId?:string;dateFrom?:string;dateTo?:string;page?:number};

const download=async(params:{dateFrom:string;dateTo:string;status?:string;search?:string;leaveTypeId?:string})=>{const response=await apiClient.get("/leave/requests/export",{params,responseType:"blob"});const url=URL.createObjectURL(response.data),link=document.createElement("a");link.href=url;link.download=`leave-${params.dateFrom}-${params.dateTo}.csv`;link.click();URL.revokeObjectURL(url);};

export const leaveApi={
  metadata:async(search="")=>(await apiClient.get("/leave/metadata",{params:{search}})).data.data as {employee:{id:string;employeeNumber:string;name:string}|null;types:Array<{id:string;code:string;name:string;color:string;allowHalfDay:boolean;attachmentRequiredAfterDays:number|null}>;employees:Array<{id:string;employeeNumber:string;name:string}>;locations:Array<{id:string;name:string}>},
  mySummary:async(year:number)=>(await apiClient.get("/leave/me/summary",{params:{year}})).data.data as {employee:{id:string;employeeNumber:string;name:string};balances:LeaveBalance[];pending:number;approved:number;approvedDays:number;upcoming:LeaveRequest[]},
  myBalances:async(year:number)=>(await apiClient.get("/leave/me/balances",{params:{year}})).data.data as LeaveBalance[],
  myRequests:async(filters:RequestFilters={})=>(await apiClient.get("/leave/me/requests",{params:{...filters,pageSize:100}})).data.data as Page<LeaveRequest>,
  createRequest:async(data:Record<string,unknown>)=>(await apiClient.post("/leave/me/requests",data)).data.data as LeaveRequest,
  cancelRequest:async(id:string,data:{version:number;reason:string})=>(await apiClient.post(`/leave/me/requests/${id}/cancel`,data)).data.data as LeaveRequest,
  requests:async(filters:RequestFilters={})=>(await apiClient.get("/leave/requests",{params:{...filters,pageSize:100}})).data.data as Page<LeaveRequest>,
  request:async(id:string)=>(await apiClient.get(`/leave/requests/${id}`)).data.data as LeaveRequest,
  review:async(id:string,data:{decision:"approved"|"rejected";comment:string|null;version:number})=>(await apiClient.post(`/leave/requests/${id}/review`,data)).data.data as LeaveRequest,
  reviewCancellation:async(id:string,data:{decision:"approved"|"rejected";comment:string|null;version:number})=>(await apiClient.post(`/leave/requests/${id}/cancellation-review`,data)).data.data as LeaveRequest,
  teamCalendar:async(dateFrom:string,dateTo:string,search="",page=1)=>(await apiClient.get("/leave/team-calendar",{params:{dateFrom,dateTo,search,page,pageSize:100}})).data.data as Page<TeamLeave>,
  exportCsv:download,
  types:async(search="",status="all")=>(await apiClient.get("/leave/types",{params:{search,status,pageSize:100}})).data.data as Page<LeaveType>,
  createType:async(data:Record<string,unknown>)=>(await apiClient.post("/leave/types",data)).data.data as LeaveType,
  updateType:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/leave/types/${id}`,data)).data.data as LeaveType,
  balances:async(params:{year:number;search?:string;leaveTypeId?:string;employeeId?:string;page?:number})=>(await apiClient.get("/leave/balances",{params:{...params,pageSize:100}})).data.data as Page<LeaveBalance>,
  adjustBalance:async(data:Record<string,unknown>)=>(await apiClient.post("/leave/balances/adjust",data)).data.data as {accountId:string;available:number},
  calendars:async()=>(await apiClient.get("/leave/calendars",{params:{pageSize:100,status:"all"}})).data.data as Page<HolidayCalendar>,
  createCalendar:async(data:Record<string,unknown>)=>(await apiClient.post("/leave/calendars",data)).data.data as HolidayCalendar,
  updateCalendar:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/leave/calendars/${id}`,data)).data.data as HolidayCalendar,
  holidays:async(params:{calendarId?:string;dateFrom?:string;dateTo?:string;search?:string}={})=>(await apiClient.get("/leave/holidays",{params:{...params,pageSize:100}})).data.data as Page<Holiday>,
  createHoliday:async(data:Record<string,unknown>)=>(await apiClient.post("/leave/holidays",data)).data.data as {id:string},
  updateHoliday:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/leave/holidays/${id}`,data)).data.data as {id:string}
};
