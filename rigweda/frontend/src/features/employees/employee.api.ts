import {apiClient} from "../../api/client";

export type EmploymentStatus = "preboarding"|"probation"|"active"|"on_leave"|"notice_period"|"suspended"|"terminated";
export type EmploymentType = "full_time"|"part_time"|"contract"|"intern"|"temporary"|"apprentice";
export type WorkMode = "onsite"|"hybrid"|"remote";

export type DirectoryEmployee = {
  id:string; employeeNumber:string; firstName:string; lastName:string; preferredName:string|null; fullName:string;
  workEmail:string|null; workPhone:string|null; profilePhotoUrl:string|null; employmentStatus:EmploymentStatus;
  employmentType:EmploymentType; workMode:WorkMode; joinDate:string; departmentId:string|null; departmentName:string|null;
  jobTitleId:string|null; jobTitleName:string|null; workLocationId:string|null; workLocationName:string|null;
  managerEmployeeId:string|null; managerName:string|null; profileCompleted:boolean; archivedAt:string|null; version:number;
};

export type EmployeeAddress = {id?:string;addressType:"current"|"permanent"|"mailing";line1:string;line2?:string|null;city:string;state?:string|null;postalCode?:string|null;country:string;isPrimary:boolean};
export type EmergencyContact = {id?:string;name:string;relationship:string;phone:string;alternatePhone?:string|null;email?:string|null;isPrimary:boolean};
export type EmployeeDetail = DirectoryEmployee & {
  userId:string|null; middleName:string|null; personalEmail:string|null; personalPhone:string|null; dateOfBirth:string|null;
  gender:string|null; pronouns:string|null; maritalStatus:string|null; bloodGroup:string|null; nationality:string|null;
  biography:string|null; probationEndDate:string|null; confirmationDate:string|null; noticeStartDate:string|null;
  lastWorkingDate:string|null; terminationDate:string|null; terminationReason:string|null; costCenter:string|null;
  timezone:string|null; metadata:Record<string,unknown>; addresses:EmployeeAddress[]; emergencyContacts:EmergencyContact[];
  profileCompleted:boolean; probationPeriodDays:number; noticePeriodDays:number; benefitsEligible:boolean; noticeEndDate:string|null;
  archivedAt:string|null; identifiers:Array<{id:string;identifierType:string;country:string;maskedValue:string;expiresOn:string|null;verifiedAt:string|null}>;
  documents:Array<{id:string;documentType:string;fileName:string;fileUrl:string;mimeType:string;sizeBytes:number|null;expiresOn:string|null;verifiedAt:string|null;createdAt:string}>;
};

export type EmployeeMetadata = {
  departments:Array<{id:string;code:string;name:string}>;
  jobTitles:Array<{id:string;code:string;name:string;jobLevel:string|null}>;
  workLocations:Array<{id:string;code:string;name:string;locationType:string;timezone:string}>;
  managers:Array<{id:string;employeeNumber:string;name:string}>;
  availableUsers:Array<{id:string;email:string;displayName:string}>;
};

export type EmployeePayload = Record<string,unknown>;
export type EmployeeFilters = {page?:number;pageSize?:number;search?:string;status?:string;employmentType?:string;departmentId?:string;workLocationId?:string;sort?:string;direction?:string};

export const employeeApi = {
  list: async(filters:EmployeeFilters={}) => (await apiClient.get("/employees",{params:filters})).data.data as {items:DirectoryEmployee[];total:number;page:number;pageSize:number;totalPages:number},
  summary: async() => (await apiClient.get("/employees/summary")).data.data as {total:number;active:number;probation:number;onLeave:number;noticePeriod:number;preboarding:number},
  metadata: async() => (await apiClient.get("/employees/metadata")).data.data as EmployeeMetadata,
  nextNumber: async() => (await apiClient.get("/employees/next-number")).data.data as {employeeNumber:string},
  upcomingEvents: async(days=45) => (await apiClient.get("/employees/upcoming-events",{params:{days}})).data.data as Array<{type:string;date:string;employeeId:string;employeeNumber:string;name:string}>,
  organizationTree: async() => (await apiClient.get("/employees/organization-tree")).data.data as Array<DirectoryEmployee&{reports:Array<DirectoryEmployee>}>,
  archived: async(filters:EmployeeFilters={}) => (await apiClient.get("/employees/archived",{params:filters})).data.data as {items:DirectoryEmployee[];total:number;page:number;pageSize:number;totalPages:number},
  myProfile: async() => (await apiClient.get("/employees/me")).data.data as EmployeeDetail,
  completeMyProfile: async(data:EmployeePayload) => (await apiClient.put("/employees/me/profile",data)).data.data as EmployeeDetail,
  get: async(id:string) => (await apiClient.get(`/employees/${id}`)).data.data as EmployeeDetail,
  history: async(id:string) => (await apiClient.get(`/employees/${id}/history`)).data.data as {
    statuses:Array<{id:string;fromStatus:string|null;toStatus:string;effectiveDate:string;reason:string|null;createdAt:string}>;
    jobs:Array<{id:string;effectiveFrom:string;effectiveTo:string|null;employmentType:string;workMode:string;reason:string|null;departmentName:string|null;jobTitleName:string|null;workLocationName:string|null;managerName:string|null}>;
    changes:Array<{id:string;eventType:string;changes:Record<string,unknown>;occurredAt:string}>;
  },
  create: async(data:EmployeePayload) => (await apiClient.post("/employees",data)).data.data as EmployeeDetail,
  update: async(id:string,data:EmployeePayload) => (await apiClient.patch(`/employees/${id}`,data)).data.data as EmployeeDetail,
  changeStatus: async(id:string,data:{status:EmploymentStatus;effectiveDate:string;reason:string;version:number}) => (await apiClient.post(`/employees/${id}/status`,data)).data.data as EmployeeDetail,
  bulkUpdate: async(data:EmployeePayload) => (await apiClient.put("/employees/bulk-update",data)).data.data as {updated:number},
  archive: async(id:string,data:{version:number;reason:string}) => (await apiClient.post(`/employees/${id}/archive`,data)).data.data as EmployeeDetail,
  restore: async(id:string,data:{version:number;reason:string}) => (await apiClient.post(`/employees/${id}/restore`,data)).data.data as EmployeeDetail,
  reopenProfile: async(id:string,version:number) => (await apiClient.post(`/employees/${id}/reopen-profile`,{version})).data.data as EmployeeDetail,
  updateSensitiveRecords: async(id:string,data:EmployeePayload) => (await apiClient.put(`/employees/${id}/sensitive-records`,data)).data.data as EmployeeDetail,
  addIdentifier: async(id:string,data:{identifierType:string;identifierValue:string;country:string;expiresOn:string|null}) => (await apiClient.post(`/employees/${id}/identifiers`,data)).data.data as EmployeeDetail,
  removeIdentifier: async(employeeId:string,recordId:string) => {await apiClient.delete(`/employees/${employeeId}/identifiers/${recordId}`);},
  addDocument: async(id:string,data:{documentType:string;fileName:string;fileUrl:string;mimeType:string;sizeBytes:number|null;expiresOn:string|null}) => (await apiClient.post(`/employees/${id}/documents`,data)).data.data as EmployeeDetail,
  removeDocument: async(employeeId:string,recordId:string) => {await apiClient.delete(`/employees/${employeeId}/documents/${recordId}`);},
  exportCsv: async(filters:EmployeeFilters={}) => {
    const response = await apiClient.get("/employees/export",{params:filters,responseType:"blob"});
    const url = URL.createObjectURL(response.data);
    const link = document.createElement("a");
    link.href=url; link.download=`employees-${new Date().toISOString().slice(0,10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  }
};
