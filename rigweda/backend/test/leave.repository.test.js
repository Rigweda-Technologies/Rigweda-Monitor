const test=require("node:test");
const assert=require("node:assert/strict");
const {LeaveRepository}=require("../src/modules/leave/leave.repository");

test("unfiltered balance counts bind the requested year safely",async()=>{
  const calls=[];
  const pool={query:async(sql,values)=>{calls.push({sql,values:[...values]});return {rows:sql.includes("COUNT(*)")?[{total:0}]:[],rowCount:0};}};
  const result=await new LeaveRepository(pool).listBalances("org-1",{year:2026,page:1,pageSize:25});
  assert.equal(result.total,0);
  assert.deepEqual(calls[0].values,["org-1",2026]);
  assert.match(calls[0].sql,/SELECT \$2::int AS requested_year/);
});

test("metadata queries never overlap on one PostgreSQL client",async()=>{
  let active=false,overlapped=false,queries=0;
  const client={
    query:async()=>{
      if(active)overlapped=true;
      active=true;queries++;
      await new Promise(resolve=>setImmediate(resolve));
      active=false;
      return {rows:queries===1?[{id:"employee-1"}]:[]};
    },
    release:()=>{}
  };
  const result=await new LeaveRepository({connect:async()=>client}).metadata("org-1","user-1","");
  assert.equal(overlapped,false);
  assert.equal(queries,4);
  assert.equal(result.employee.id,"employee-1");
});
