import {apiClient} from "../../api/client";
export type AttendanceStatus="not_marked"|"present"|"absent"|"half_day"|"on_leave"|"holiday"|"weekly_off"|"missing_punch";
export type Shift={id:string;code:string;name:string;description:string|null;startTime:string;endTime:string;unpaidBreakMinutes:number;workingDays:number[];color:string;isDefault:boolean;status:"active"|"inactive";version:number;assignmentCount:number};
export type ShiftAssignment={id:string;employeeId:string;employeeNumber:string;employeeName:string;shiftTemplateId:string;shiftName:string;effectiveFrom:string;effectiveTo:string|null;reason:string|null;version:number};
export type AttendanceRecord={id:string|null;employeeId:string;employeeNumber:string;employeeName:string;departmentName:string|null;jobTitleName?:string|null;attendanceDate?:string;shiftName:string|null;status:AttendanceStatus;clockInAt:string|null;clockOutAt:string|null;workedMinutes:number;breakMinutes?:number;lateMinutes:number;overtimeMinutes:number;earlyDepartureMinutes?:number;lastAction:string|null;source?:string;notes?:string|null;version:number;punches?:Array<{id:string;action:string;punchedAt:string;source:string}>};
export type Regularization={id:string;employeeId:string;employeeNumber:string;employeeName:string;attendanceDate:string;requestedClockIn:string|null;requestedClockOut:string|null;requestedStatus:AttendanceStatus|null;reason:string;status:"pending"|"approved"|"rejected"|"cancelled";reviewerComment:string|null;reviewerName:string|null;reviewedAt:string|null;version:number;createdAt:string};
export type AttendancePolicy={id:string;name:string;fullDayMinutes:number;halfDayMinutes:number;graceMinutes:number;overtimeAfterMinutes:number;maximumShiftMinutes:number;weekendDays:number[];allowWebPunch:boolean;requireGeolocation:boolean;allowRegularization:boolean;regularizationWindowDays:number;version:number};
type Page<T>={items:T[];total:number;page:number;pageSize:number;totalPages:number};
const download=async(path:string,params:Record<string,unknown>)=>{const response=await apiClient.get(path,{params,responseType:"blob"});const url=URL.createObjectURL(response.data),link=document.createElement("a");link.href=url;link.download=`attendance-${String(params.dateFrom)}-${String(params.dateTo)}.csv`;link.click();URL.revokeObjectURL(url);};
export const attendanceApi={
  metadata:async()=>(await apiClient.get("/attendance/metadata")).data.data as {employees:Array<{id:string;employeeNumber:string;name:string}>;shifts:Array<{id:string;code:string;name:string}>},
  myToday:async()=>(await apiClient.get("/attendance/me/today")).data.data as {employee:{id:string;employeeNumber:string;name:string};date:string;timezone:string;shift:Shift|null;record:AttendanceRecord|null},
  punch:async(data:{action:string;latitude?:number;longitude?:number;deviceInfo?:string})=>(await apiClient.post("/attendance/me/punch",data)).data.data as AttendanceRecord,
  daily:async(date:string,search="",status="all")=>(await apiClient.get("/attendance/daily",{params:{date,search,status,pageSize:100}})).data.data as Page<AttendanceRecord>,
  dailySummary:async(date:string)=>(await apiClient.get("/attendance/daily/summary",{params:{date}})).data.data as {total:number;present:number;absent:number;halfDay:number;onLeave:number;notMarked:number;late:number;openPunches:number},
  records:async(params:{dateFrom:string;dateTo:string;search?:string;status?:string})=>(await apiClient.get("/attendance/records",{params:{...params,pageSize:100}})).data.data as Page<AttendanceRecord>,
  record:async(id:string)=>(await apiClient.get(`/attendance/records/${id}`)).data.data as AttendanceRecord,
  manual:async(data:Record<string,unknown>)=>(await apiClient.put("/attendance/records",data)).data.data as AttendanceRecord,
  exportCsv:async(params:{dateFrom:string;dateTo:string;search?:string;status?:string})=>download("/attendance/records/export",params),
  shifts:async(search="",status="all")=>(await apiClient.get("/attendance/shifts",{params:{search,status,pageSize:100}})).data.data as Page<Shift>,
  createShift:async(data:Record<string,unknown>)=>(await apiClient.post("/attendance/shifts",data)).data.data as Shift,
  updateShift:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/attendance/shifts/${id}`,data)).data.data as Shift,
  assignments:async(search="")=>(await apiClient.get("/attendance/assignments",{params:{search,pageSize:100}})).data.data as Page<ShiftAssignment>,
  createAssignment:async(data:Record<string,unknown>)=>(await apiClient.post("/attendance/assignments",data)).data.data as ShiftAssignment,
  updateAssignment:async(id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/attendance/assignments/${id}`,data)).data.data as ShiftAssignment,
  policy:async()=>(await apiClient.get("/attendance/policy")).data.data as AttendancePolicy,
  updatePolicy:async(data:Record<string,unknown>)=>(await apiClient.patch("/attendance/policy",data)).data.data as AttendancePolicy,
  regularizations:async(status="pending")=>(await apiClient.get("/attendance/regularizations",{params:{status,pageSize:100}})).data.data as Page<Regularization>,
  myRegularizations:async(status="all")=>(await apiClient.get("/attendance/me/regularizations",{params:{status,pageSize:100}})).data.data as Page<Regularization>,
  createRegularization:async(data:Record<string,unknown>)=>(await apiClient.post("/attendance/me/regularizations",data)).data.data,
  cancelRegularization:async(id:string,version:number)=>(await apiClient.post(`/attendance/me/regularizations/${id}/cancel`,{version})).data.data,
  reviewRegularization:async(id:string,data:{decision:"approved"|"rejected";comment:string|null;version:number})=>(await apiClient.post(`/attendance/regularizations/${id}/review`,data)).data.data
};
