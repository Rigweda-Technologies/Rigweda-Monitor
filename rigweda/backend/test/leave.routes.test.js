const test=require("node:test");
const assert=require("node:assert/strict");
const express=require("express");
const request=require("supertest");
const {createLeaveRouter}=require("../src/modules/leave/leave.routes");
const {errorHandler}=require("../src/middleware/error-handler");

const service={metadata:async()=>({}),mySummary:async()=>({}),myBalances:async()=>[],myRequests:async(_o,_u,q)=>q,createRequest:async(_o,_u,data)=>data,cancel:async()=>({}),teamCalendar:async()=>[],reportSummary:async()=>({}),export:async()=>"csv",requests:async(_o,q)=>q,request:async()=>({}),review:async()=>({}),reviewCancellation:async()=>({}),types:async(_o,q)=>q,type:async()=>({}),createType:async(_o,data)=>data,updateType:async(_o,_id,data)=>data,balances:async(_o,q)=>q,adjustBalance:async(_o,data)=>data,calendars:async(_o,q)=>q,createCalendar:async(_o,data)=>data,updateCalendar:async(_o,_id,data)=>data,holidays:async(_o,q)=>q,createHoliday:async(_o,data)=>data,updateHoliday:async(_o,_id,data)=>data};
const app=express();app.use(express.json());app.use((req,_res,next)=>{req.auth={organizationId:"org",userId:"user"};next();});const pass=(_req,_res,next)=>next();app.use("/leave",createLeaveRouter(service,{self:pass,approve:pass,configure:pass,export:pass}));app.use(errorHandler);

test("self leave request listing defaults bounded pagination",async()=>{const response=await request(app).get("/leave/me/requests").expect(200);assert.equal(response.body.data.page,1);assert.equal(response.body.data.pageSize,25);});
test("leave request submission validates sessions and reason",async()=>{await request(app).post("/leave/me/requests").send({leaveTypeId:"3ef8a850-6ae7-45a3-8d77-cfa0a85ad604",startDate:"2026-08-08",endDate:"2026-08-08",reason:"x"}).expect(422);await request(app).post("/leave/me/requests").send({leaveTypeId:"3ef8a850-6ae7-45a3-8d77-cfa0a85ad604",startDate:"2026-08-08",endDate:"2026-08-08",reason:"Family event"}).expect(201);});
test("leave type updates require optimistic versions",async()=>{await request(app).patch("/leave/types/3ef8a850-6ae7-45a3-8d77-cfa0a85ad604").send({name:"Updated"}).expect(422);});
test("balance adjustments reject zero and require a reason",async()=>{await request(app).post("/leave/balances/adjust").send({employeeId:"3ef8a850-6ae7-45a3-8d77-cfa0a85ad604",leaveTypeId:"5ef8a850-6ae7-45a3-8d77-cfa0a85ad604",year:2026,amountDays:0,reason:"Correction"}).expect(422);});
test("cancellation requires an explicit optimistic version",async()=>{await request(app).post("/leave/me/requests/3ef8a850-6ae7-45a3-8d77-cfa0a85ad604/cancel").send({reason:"Plans changed"}).expect(422);});
