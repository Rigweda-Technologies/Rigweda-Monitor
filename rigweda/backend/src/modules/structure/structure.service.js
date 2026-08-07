const {AppError}=require("../../lib/app-error");

class StructureService{
  constructor(repository){this.repository=repository;}
  paged(result,query){return {...result,page:query.page,pageSize:query.pageSize,totalPages:Math.ceil(result.total/query.pageSize)};}
  listDepartments(organizationId,query){return this.repository.listDepartments(organizationId,query).then(result=>this.paged(result,query));}
  listJobTitles(organizationId,query){return this.repository.listJobTitles(organizationId,query).then(result=>this.paged(result,query));}
  listLocations(organizationId,query){return this.repository.listLocations(organizationId,query).then(result=>this.paged(result,query));}
  summary(organizationId){return this.repository.summary(organizationId);}
  metadata(organizationId){return this.repository.metadata(organizationId);}
  async departmentTree(organizationId){const items=await this.repository.allDepartments(organizationId);const byId=new Map(items.map(item=>[item.id,{...item,children:[]}]));const roots=[];for(const item of byId.values()){const parent=byId.get(item.parentDepartmentId);if(parent)parent.children.push(item);else roots.push(item);}return roots;}
  async get(kind,organizationId,id){const entity=await this.finder(kind)(organizationId,id);if(!entity)throw new AppError(404,"STRUCTURE_ENTITY_NOT_FOUND",`${this.label(kind)} not found.`);return entity;}
  async history(kind,organizationId,id){await this.get(kind,organizationId,id);return this.repository.getHistory(organizationId,kind,id);}
  async create(kind,organizationId,data,actorUserId){try{const result=await this.creator(kind)(organizationId,data,actorUserId);return this.resolveResult(kind,result);}catch(error){this.translate(error,kind);}}
  async update(kind,organizationId,id,data,actorUserId){try{const result=await this.updater(kind)(organizationId,id,data,actorUserId);return this.resolveResult(kind,result);}catch(error){this.translate(error,kind);}}
  resolveResult(kind,result){if(result?.error==="not_found")throw new AppError(404,"STRUCTURE_ENTITY_NOT_FOUND",`${this.label(kind)} not found.`);if(result?.error==="version")throw new AppError(409,"VERSION_CONFLICT",`This ${this.label(kind).toLowerCase()} was changed by someone else. Refresh and try again.`);if(result?.error==="reference"){const cycle=result.field==="parentDepartmentIdCycle";throw new AppError(422,cycle?"DEPARTMENT_CYCLE":"INVALID_STRUCTURE_REFERENCE",cycle?"A department cannot be moved beneath itself or one of its descendants.":`The selected ${result.field} does not belong to this organization.`);}return result;}
  translate(error,kind){if(error.code==="23505")throw new AppError(409,"STRUCTURE_CONFLICT",`A ${this.label(kind).toLowerCase()} with this code or name already exists.`);if(error.code==="23503")throw new AppError(422,"STRUCTURE_REFERENCE_IN_USE",`This ${this.label(kind).toLowerCase()} has an invalid or protected relationship.`);throw error;}
  finder(kind){return kind==="department"?this.repository.findDepartment.bind(this.repository):kind==="job_title"?this.repository.findJobTitle.bind(this.repository):this.repository.findLocation.bind(this.repository);}
  creator(kind){return kind==="department"?this.repository.createDepartment.bind(this.repository):kind==="job_title"?this.repository.createJobTitle.bind(this.repository):this.repository.createLocation.bind(this.repository);}
  updater(kind){return kind==="department"?this.repository.updateDepartment.bind(this.repository):kind==="job_title"?this.repository.updateJobTitle.bind(this.repository):this.repository.updateLocation.bind(this.repository);}
  label(kind){return kind==="department"?"Department":kind==="job_title"?"Designation":"Work location";}
}

module.exports={StructureService};
