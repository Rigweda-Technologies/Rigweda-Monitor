const test=require("node:test");
const assert=require("node:assert/strict");
const express=require("express");
const request=require("supertest");
const {createStructureRouter}=require("../src/modules/structure/structure.routes");
const {errorHandler}=require("../src/middleware/error-handler");

const service={summary:async()=>({departments:1}),metadata:async()=>({headCandidates:[]}),departmentTree:async()=>[],listDepartments:async(_org,query)=>({items:[],...query}),listJobTitles:async()=>({items:[]}),listLocations:async()=>({items:[]}),create:async(kind,_org,body)=>({kind,...body}),get:async()=>({id:"entity"}),history:async()=>[],update:async(kind,_org,id,body)=>({kind,id,...body})};
const app=express();app.use(express.json());app.use((req,_res,next)=>{req.auth={organizationId:"org",userId:"user"};next();});app.use("/structure",createStructureRouter(service,(_req,_res,next)=>next()));app.use(errorHandler);

test("department list defaults pagination and status",async()=>{const response=await request(app).get("/structure/departments").expect(200);assert.equal(response.body.data.page,1);assert.equal(response.body.data.status,"all");});
test("department creation validates codes and names",async()=>{await request(app).post("/structure/departments").send({code:"bad code",name:"A"}).expect(422);const response=await request(app).post("/structure/departments").send({code:"ENGINEERING",name:"Engineering"}).expect(201);assert.equal(response.body.data.code,"ENGINEERING");});
test("job title update requires an optimistic version",async()=>{await request(app).patch("/structure/job-titles/3ef8a850-6ae7-45a3-8d77-cfa0a85ad604").send({name:"Engineer"}).expect(422);});
test("work location supports regional metadata",async()=>{const response=await request(app).post("/structure/work-locations").send({code:"HYD",name:"Hyderabad",locationType:"office",timezone:"Asia/Kolkata",address:{city:"Hyderabad",country:"IN"},capacity:120}).expect(201);assert.equal(response.body.data.capacity,120);});
