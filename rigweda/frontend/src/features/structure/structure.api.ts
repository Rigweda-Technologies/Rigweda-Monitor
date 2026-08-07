import {apiClient} from "../../api/client";

export type StructureStatus="active"|"inactive";
export type Department={id:string;code:string;name:string;description:string|null;parentDepartmentId:string|null;parentDepartmentName:string|null;headEmployeeId:string|null;headEmployeeName:string|null;costCenter:string|null;status:StructureStatus;version:number;employeeCount:number;childCount:number;createdAt:string;updatedAt:string};
export type DepartmentNode=Department&{children:DepartmentNode[]};
export type JobTitle={id:string;code:string;name:string;description:string|null;jobLevel:string|null;grade:string|null;careerTrack:"individual"|"management"|"executive"|"support"|null;status:StructureStatus;version:number;employeeCount:number;createdAt:string;updatedAt:string};
export type WorkLocation={id:string;code:string;name:string;description:string|null;locationType:"office"|"branch"|"client_site"|"remote"|"other";timezone:string;address:Record<string,string>;email:string|null;phone:string|null;capacity:number|null;status:StructureStatus;version:number;employeeCount:number;createdAt:string;updatedAt:string};
export type StructureEntity=Department|JobTitle|WorkLocation;
export type StructureKind="department"|"job_title"|"work_location";
export type StructureHistory={id:string;eventType:"created"|"updated"|"activated"|"deactivated";before:Record<string,unknown>|null;after:Record<string,unknown>;actorName:string|null;occurredAt:string};
type Filters={page?:number;pageSize?:number;search?:string;status?:string};
type Page<T>={items:T[];total:number;page:number;pageSize:number;totalPages:number};
const resource=(kind:StructureKind)=>kind==="department"?"departments":kind==="job_title"?"job-titles":"work-locations";

export const structureApi={
  summary:async()=>(await apiClient.get("/structure/summary")).data.data as {departments:number;activeDepartments:number;jobTitles:number;activeJobTitles:number;locations:number;activeLocations:number;unassignedDepartments:number;unassignedJobTitles:number;unassignedLocations:number},
  metadata:async()=>(await apiClient.get("/structure/metadata")).data.data as {headCandidates:Array<{id:string;employeeNumber:string;name:string}>},
  departments:async(filters:Filters={})=>(await apiClient.get("/structure/departments",{params:filters})).data.data as Page<Department>,
  departmentTree:async()=>(await apiClient.get("/structure/departments/tree")).data.data as DepartmentNode[],
  jobTitles:async(filters:Filters={})=>(await apiClient.get("/structure/job-titles",{params:filters})).data.data as Page<JobTitle>,
  workLocations:async(filters:Filters={})=>(await apiClient.get("/structure/work-locations",{params:filters})).data.data as Page<WorkLocation>,
  create:async(kind:StructureKind,data:Record<string,unknown>)=>(await apiClient.post(`/structure/${resource(kind)}`,data)).data.data as StructureEntity,
  update:async(kind:StructureKind,id:string,data:Record<string,unknown>)=>(await apiClient.patch(`/structure/${resource(kind)}/${id}`,data)).data.data as StructureEntity,
  history:async(kind:StructureKind,id:string)=>(await apiClient.get(`/structure/${resource(kind)}/${id}/history`)).data.data as StructureHistory[]
};
