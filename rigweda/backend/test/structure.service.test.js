const test=require("node:test");
const assert=require("node:assert/strict");
const {StructureService}=require("../src/modules/structure/structure.service");

const repository=()=>({
  listDepartments:async()=>({items:[],total:51}),listJobTitles:async()=>({items:[],total:0}),listLocations:async()=>({items:[],total:0}),
  allDepartments:async()=>[],findDepartment:async()=>null,findJobTitle:async()=>null,findLocation:async()=>null,
  createDepartment:async(_org,data)=>({...data,id:"department-1"}),createJobTitle:async(_org,data)=>({...data,id:"title-1"}),createLocation:async(_org,data)=>({...data,id:"location-1"}),
  updateDepartment:async()=>({id:"department-1"}),updateJobTitle:async()=>({id:"title-1"}),updateLocation:async()=>({id:"location-1"}),
  getHistory:async()=>[],summary:async()=>({departments:1}),metadata:async()=>({headCandidates:[]})
});

test("structure listings expose stable pagination",async()=>{const service=new StructureService(repository());const result=await service.listDepartments("org",{page:2,pageSize:25});assert.equal(result.totalPages,3);assert.equal(result.page,2);});
test("department tree nests every level",async()=>{const repo=repository();repo.allDepartments=async()=>[{id:"a",parentDepartmentId:null,name:"A"},{id:"b",parentDepartmentId:"a",name:"B"},{id:"c",parentDepartmentId:"b",name:"C"}];const tree=await new StructureService(repo).departmentTree("org");assert.equal(tree[0].children[0].children[0].name,"C");});
test("department cycles are translated to a useful validation error",async()=>{const repo=repository();repo.updateDepartment=async()=>({error:"reference",field:"parentDepartmentIdCycle"});await assert.rejects(()=>new StructureService(repo).update("department","org","id",{version:1},"user"),error=>error.code==="DEPARTMENT_CYCLE"&&error.statusCode===422);});
test("optimistic concurrency conflicts are reported",async()=>{const repo=repository();repo.updateJobTitle=async()=>({error:"version"});await assert.rejects(()=>new StructureService(repo).update("job_title","org","id",{version:1},"user"),error=>error.code==="VERSION_CONFLICT"&&error.statusCode===409);});
test("organization-scoped structure references are enforced",async()=>{const repo=repository();repo.createDepartment=async()=>({error:"reference",field:"headEmployeeId"});await assert.rejects(()=>new StructureService(repo).create("department","org",{},"user"),error=>error.code==="INVALID_STRUCTURE_REFERENCE");});
test("unique codes and names become conflicts",async()=>{const repo=repository();repo.createLocation=async()=>{const error=new Error("duplicate");error.code="23505";throw error;};await assert.rejects(()=>new StructureService(repo).create("work_location","org",{},"user"),error=>error.code==="STRUCTURE_CONFLICT"&&error.statusCode===409);});
test("history is only returned for an existing entity",async()=>{const repo=repository();await assert.rejects(()=>new StructureService(repo).history("department","org","missing"),error=>error.code==="STRUCTURE_ENTITY_NOT_FOUND");});
