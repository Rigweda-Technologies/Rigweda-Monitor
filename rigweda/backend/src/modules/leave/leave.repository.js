const has=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const nullable=value=>value===""||value===undefined?null:value;
const numeric=value=>Number(value||0);
const available=row=>numeric(row.opening_days??row.openingDays)+numeric(row.accrued_days??row.accruedDays)+numeric(row.adjusted_days??row.adjustedDays)+numeric(row.carried_forward_days??row.carriedForwardDays)-numeric(row.used_days??row.usedDays)-numeric(row.pending_days??row.pendingDays)-numeric(row.encashed_days??row.encashedDays);

const typeColumns=`lt.id,lt.code,lt.name,lt.description,lt.color,lt.annual_entitlement_days::float AS "annualEntitlementDays",lt.is_paid AS "isPaid",lt.requires_approval AS "requiresApproval",lt.allow_half_day AS "allowHalfDay",lt.allow_negative_balance AS "allowNegativeBalance",lt.maximum_negative_days::float AS "maximumNegativeDays",lt.minimum_notice_days AS "minimumNoticeDays",lt.maximum_consecutive_days AS "maximumConsecutiveDays",lt.attachment_required_after_days::float AS "attachmentRequiredAfterDays",lt.carry_forward_allowed AS "carryForwardAllowed",lt.maximum_carry_forward_days::float AS "maximumCarryForwardDays",lt.encashment_allowed AS "encashmentAllowed",lt.status,lt.version,lt.created_at AS "createdAt",lt.updated_at AS "updatedAt"`;
const requestColumns=`lr.id,lr.employee_id AS "employeeId",e.employee_number AS "employeeNumber",CONCAT_WS(' ',e.first_name,e.last_name) AS "employeeName",lr.leave_type_id AS "leaveTypeId",lt.code AS "leaveTypeCode",lt.name AS "leaveTypeName",lt.color AS "leaveTypeColor",TO_CHAR(lr.start_date,'YYYY-MM-DD') AS "startDate",TO_CHAR(lr.end_date,'YYYY-MM-DD') AS "endDate",lr.start_session AS "startSession",lr.end_session AS "endSession",lr.requested_days::float AS "requestedDays",lr.reason,lr.emergency_contact AS "emergencyContact",lr.handover_employee_id AS "handoverEmployeeId",CONCAT_WS(' ',handover.first_name,handover.last_name) AS "handoverEmployeeName",lr.attachment_name AS "attachmentName",lr.attachment_url AS "attachmentUrl",lr.status,lr.submitted_at AS "submittedAt",reviewer.display_name AS "reviewerName",lr.reviewer_comment AS "reviewerComment",lr.reviewed_at AS "reviewedAt",lr.cancellation_reason AS "cancellationReason",cancel_reviewer.display_name AS "cancellationReviewerName",lr.cancellation_comment AS "cancellationComment",lr.cancellation_reviewed_at AS "cancellationReviewedAt",lr.version,lr.created_at AS "createdAt",lr.updated_at AS "updatedAt"`;
const requestJoins=`JOIN employees e ON e.id=lr.employee_id JOIN leave_types lt ON lt.id=lr.leave_type_id LEFT JOIN employees handover ON handover.id=lr.handover_employee_id LEFT JOIN users reviewer ON reviewer.id=lr.reviewed_by LEFT JOIN users cancel_reviewer ON cancel_reviewer.id=lr.cancellation_reviewed_by`;
const balanceColumns=`a.id AS "accountId",a.employee_id AS "employeeId",e.employee_number AS "employeeNumber",CONCAT_WS(' ',e.first_name,e.last_name) AS "employeeName",a.leave_type_id AS "leaveTypeId",lt.code AS "leaveTypeCode",lt.name AS "leaveTypeName",lt.color AS "leaveTypeColor",TO_CHAR(a.period_start,'YYYY-MM-DD') AS "periodStart",TO_CHAR(a.period_end,'YYYY-MM-DD') AS "periodEnd",a.opening_days::float AS "openingDays",a.accrued_days::float AS "accruedDays",a.adjusted_days::float AS "adjustedDays",a.carried_forward_days::float AS "carriedForwardDays",a.used_days::float AS "usedDays",a.pending_days::float AS "pendingDays",a.encashed_days::float AS "encashedDays",(a.opening_days+a.accrued_days+a.adjusted_days+a.carried_forward_days-a.used_days-a.pending_days-a.encashed_days)::float AS available,a.version`;

class LeaveRepository{
  constructor(pool){this.pool=pool;}

  async organizationClock(client,organizationId){return (await client.query(`SELECT timezone,TO_CHAR((NOW() AT TIME ZONE timezone)::date,'YYYY-MM-DD') today FROM organizations WHERE id=$1`,[organizationId])).rows[0];}
  async employeeForUser(client,organizationId,userId,lock=false){return (await client.query(`SELECT id,employee_number AS "employeeNumber",CONCAT_WS(' ',first_name,last_name) name,work_location_id AS "workLocationId" FROM employees WHERE organization_id=$1 AND user_id=$2 AND archived_at IS NULL${lock?" FOR UPDATE":""}`,[organizationId,userId])).rows[0]||null;}
  async findType(organizationId,id,client=this.pool){return (await client.query(`SELECT ${typeColumns} FROM leave_types lt WHERE lt.organization_id=$1 AND lt.id=$2`,[organizationId,id])).rows[0]||null;}

  async metadata(organizationId,userId,search=""){
    const client=await this.pool.connect();
    try{
      const employee=await this.employeeForUser(client,organizationId,userId);
      const values=[organizationId];let filter="";
      if(search){values.push(`%${search}%`);filter=` AND (employee_number ILIKE $2 OR CONCAT_WS(' ',first_name,last_name) ILIKE $2)`;}
      const types=await client.query(`SELECT id,code,name,color,allow_half_day AS "allowHalfDay",attachment_required_after_days::float AS "attachmentRequiredAfterDays" FROM leave_types WHERE organization_id=$1 AND status='active' ORDER BY name`,[organizationId]);
      const employees=await client.query(`SELECT id,employee_number AS "employeeNumber",CONCAT_WS(' ',first_name,last_name) name FROM employees WHERE organization_id=$1 AND archived_at IS NULL AND employment_status<>'terminated'${filter} ORDER BY first_name,last_name LIMIT 50`,values);
      const locations=await client.query(`SELECT id,name FROM work_locations WHERE organization_id=$1 AND status='active' ORDER BY name`,[organizationId]);
      return {employee,types:types.rows,employees:employees.rows,locations:locations.rows};
    }finally{client.release();}
  }

  async listTypes(organizationId,query){
    const values=[organizationId],where=["lt.organization_id=$1"];
    if(query.search){values.push(`%${query.search}%`);where.push(`(lt.code ILIKE $${values.length} OR lt.name ILIKE $${values.length})`);}
    if(query.status!=="all"){values.push(query.status);where.push(`lt.status=$${values.length}`);}
    const count=await this.pool.query(`SELECT COUNT(*)::int total FROM leave_types lt WHERE ${where.join(" AND ")}`,values);
    values.push(query.pageSize,(query.page-1)*query.pageSize);
    const result=await this.pool.query(`SELECT ${typeColumns},COUNT(lr.id) FILTER(WHERE lr.status IN ('pending','approved','cancel_requested'))::int AS "activeRequestCount" FROM leave_types lt LEFT JOIN leave_requests lr ON lr.leave_type_id=lt.id WHERE ${where.join(" AND ")} GROUP BY lt.id ORDER BY lt.status,lt.name LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    return {items:result.rows,total:count.rows[0].total};
  }
  async createType(organizationId,data,actorUserId){
    const result=await this.pool.query(`INSERT INTO leave_types(organization_id,code,name,description,color,annual_entitlement_days,is_paid,requires_approval,allow_half_day,allow_negative_balance,maximum_negative_days,minimum_notice_days,maximum_consecutive_days,attachment_required_after_days,carry_forward_allowed,maximum_carry_forward_days,encashment_allowed,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19) RETURNING id`,[organizationId,data.code,data.name,nullable(data.description),data.color,data.annualEntitlementDays,data.isPaid,data.requiresApproval,data.allowHalfDay,data.allowNegativeBalance,data.maximumNegativeDays,data.minimumNoticeDays,nullable(data.maximumConsecutiveDays),nullable(data.attachmentRequiredAfterDays),data.carryForwardAllowed,data.maximumCarryForwardDays,data.encashmentAllowed,data.status,actorUserId]);
    return this.findType(organizationId,result.rows[0].id);
  }
  async updateType(organizationId,id,data,actorUserId){
    const mapping={code:"code",name:"name",description:"description",color:"color",annualEntitlementDays:"annual_entitlement_days",isPaid:"is_paid",requiresApproval:"requires_approval",allowHalfDay:"allow_half_day",allowNegativeBalance:"allow_negative_balance",maximumNegativeDays:"maximum_negative_days",minimumNoticeDays:"minimum_notice_days",maximumConsecutiveDays:"maximum_consecutive_days",attachmentRequiredAfterDays:"attachment_required_after_days",carryForwardAllowed:"carry_forward_allowed",maximumCarryForwardDays:"maximum_carry_forward_days",encashmentAllowed:"encashment_allowed",status:"status"};
    const values=[organizationId,id,data.version],sets=[];
    for(const [key,column] of Object.entries(mapping))if(has(data,key)){values.push(nullable(data[key]));sets.push(`${column}=$${values.length}`);}
    values.push(actorUserId);sets.push(`updated_by=$${values.length}`,"version=version+1");
    const result=await this.pool.query(`UPDATE leave_types SET ${sets.join(",")} WHERE organization_id=$1 AND id=$2 AND version=$3 RETURNING id`,values);
    return result.rowCount?this.findType(organizationId,id):null;
  }

  async calendarForEmployee(client,organizationId,employeeId){
    return (await client.query(`SELECT hc.id FROM employees e JOIN organizations o ON o.id=e.organization_id LEFT JOIN holiday_calendar_locations hcl ON hcl.organization_id=e.organization_id AND hcl.work_location_id=e.work_location_id LEFT JOIN holiday_calendars scoped ON scoped.id=hcl.calendar_id AND scoped.status='active' LEFT JOIN holiday_calendars hc ON hc.id=COALESCE(scoped.id,(SELECT id FROM holiday_calendars WHERE organization_id=e.organization_id AND is_default AND status='active' LIMIT 1)) WHERE e.organization_id=$1 AND e.id=$2`,[organizationId,employeeId])).rows[0]?.id||null;
  }
  async workingDays(client,organizationId,employeeId,data){
    const calendarId=await this.calendarForEmployee(client,organizationId,employeeId);
    const result=await client.query(`SELECT TO_CHAR(day,'YYYY-MM-DD') date FROM generate_series($2::date,$3::date,'1 day') day JOIN attendance_policies ap ON ap.organization_id=$1 WHERE NOT EXTRACT(DOW FROM day)::int=ANY(ap.weekend_days) AND NOT EXISTS(SELECT 1 FROM holidays h WHERE h.organization_id=$1 AND h.calendar_id=$4 AND h.holiday_date=day::date AND h.is_optional=FALSE) ORDER BY day`,[organizationId,data.startDate,data.endDate,calendarId]);
    const rows=result.rows.map((row,index,array)=>{let session="full_day",fraction=1;if(array.length===1&&(data.startSession!=="full_day"||data.endSession!=="full_day")){session=data.startSession!=="full_day"?data.startSession:data.endSession;fraction=.5;}else if(index===0&&data.startSession!=="full_day"){session=data.startSession;fraction=.5;}else if(index===array.length-1&&data.endSession!=="full_day"){session=data.endSession;fraction=.5;}return {date:row.date,session,fraction};});
    return rows;
  }
  async ensureAccount(client,organizationId,employeeId,type,year){
    const periodStart=`${year}-01-01`,periodEnd=`${year}-12-31`;
    const inserted=await client.query(`INSERT INTO leave_balance_accounts(organization_id,employee_id,leave_type_id,period_start,period_end,opening_days) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,employee_id,leave_type_id,period_start) DO NOTHING RETURNING id`,[organizationId,employeeId,type.id,periodStart,periodEnd,type.annualEntitlementDays]);
    const account=(await client.query(`SELECT * FROM leave_balance_accounts WHERE organization_id=$1 AND employee_id=$2 AND leave_type_id=$3 AND period_start=$4 FOR UPDATE`,[organizationId,employeeId,type.id,periodStart])).rows[0];
    if(inserted.rowCount)await client.query(`INSERT INTO leave_balance_ledger(organization_id,account_id,transaction_type,amount_days,balance_after,reference_type,notes) VALUES($1,$2,'opening',$3,$3,'policy','Annual entitlement')`,[organizationId,account.id,type.annualEntitlementDays]);
    return account;
  }
  async addLedger(client,organizationId,accountId,type,amount,referenceId,notes,actorUserId){
    const row=(await client.query(`SELECT (opening_days+accrued_days+adjusted_days+carried_forward_days-used_days-pending_days-encashed_days)::float available FROM leave_balance_accounts WHERE id=$1`,[accountId])).rows[0];
    await client.query(`INSERT INTO leave_balance_ledger(organization_id,account_id,transaction_type,amount_days,balance_after,reference_type,reference_id,notes,actor_user_id) VALUES($1,$2,$3,$4,$5,'leave_request',$6,$7,$8)`,[organizationId,accountId,type,amount,row.available,referenceId,notes,actorUserId]);
  }
  async syncAttendance(client,request){
    await client.query(`INSERT INTO attendance_records(organization_id,employee_id,attendance_date,status,source,notes,leave_request_id) SELECT d.organization_id,d.employee_id,d.leave_date,CASE WHEN d.fraction=.5 THEN 'half_day' ELSE 'on_leave' END,'system','Approved leave',d.request_id FROM leave_request_days d WHERE d.request_id=$1 ON CONFLICT(organization_id,employee_id,attendance_date) DO NOTHING`,[request.id]);
  }
  async removeAttendance(client,requestId){await client.query(`DELETE FROM attendance_records WHERE leave_request_id=$1 AND source='system' AND status IN ('on_leave','half_day') AND last_action IS NULL`,[requestId]);}

  async createRequest(organizationId,userId,data){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const employee=await this.employeeForUser(client,organizationId,userId,true);
      if(!employee){await client.query("ROLLBACK");return {error:"employee"};}
      const type=await this.findType(organizationId,data.leaveTypeId,client);
      if(!type||type.status!=="active"){await client.query("ROLLBACK");return {error:"type"};}
      const clock=await this.organizationClock(client,organizationId);
      const notice=Math.floor((new Date(`${data.startDate}T00:00:00Z`)-new Date(`${clock.today}T00:00:00Z`))/86400000);
      if(notice<type.minimumNoticeDays){await client.query("ROLLBACK");return {error:"notice",minimum:type.minimumNoticeDays};}
      if((data.startSession!=="full_day"||data.endSession!=="full_day")&&!type.allowHalfDay){await client.query("ROLLBACK");return {error:"half_day"};}
      if(data.handoverEmployeeId){const handover=await client.query(`SELECT 1 FROM employees WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL`,[organizationId,data.handoverEmployeeId]);if(!handover.rowCount){await client.query("ROLLBACK");return {error:"handover"};}}
      const days=await this.workingDays(client,organizationId,employee.id,data),total=days.reduce((sum,row)=>sum+row.fraction,0);
      if(!days.length){await client.query("ROLLBACK");return {error:"no_working_days"};}
      if(type.maximumConsecutiveDays&&total>type.maximumConsecutiveDays){await client.query("ROLLBACK");return {error:"maximum",maximum:type.maximumConsecutiveDays};}
      if(type.attachmentRequiredAfterDays&&total>=type.attachmentRequiredAfterDays&&!data.attachmentName){await client.query("ROLLBACK");return {error:"attachment",threshold:type.attachmentRequiredAfterDays};}
      const overlap=await client.query(`SELECT 1 FROM leave_request_days d JOIN leave_requests lr ON lr.id=d.request_id WHERE d.organization_id=$1 AND d.employee_id=$2 AND d.leave_date=ANY($3::date[]) AND lr.status IN ('pending','approved','cancel_requested') LIMIT 1`,[organizationId,employee.id,days.map(row=>row.date)]);
      if(overlap.rowCount){await client.query("ROLLBACK");return {error:"overlap"};}
      const grouped=Object.groupBy(days,row=>row.date.slice(0,4)),accounts=[];
      for(const [year,yearDays] of Object.entries(grouped)){
        const account=await this.ensureAccount(client,organizationId,employee.id,type,year),allocated=yearDays.reduce((sum,row)=>sum+row.fraction,0),remaining=available(account)-allocated;
        if(remaining<0&&(!type.allowNegativeBalance||remaining < -type.maximumNegativeDays)){await client.query("ROLLBACK");return {error:"balance",available:available(account),required:allocated,year:Number(year)};}
        accounts.push({account,allocated});
      }
      const status=type.requiresApproval?"pending":"approved";
      const inserted=await client.query(`INSERT INTO leave_requests(organization_id,employee_id,leave_type_id,balance_account_id,start_date,end_date,start_session,end_session,requested_days,reason,emergency_contact,handover_employee_id,attachment_name,attachment_url,status,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()) RETURNING id`,[organizationId,employee.id,type.id,accounts[0].account.id,data.startDate,data.endDate,data.startSession,data.endSession,total,data.reason,nullable(data.emergencyContact),nullable(data.handoverEmployeeId),nullable(data.attachmentName),nullable(data.attachmentUrl),status]);
      const requestId=inserted.rows[0].id;
      await client.query(`INSERT INTO leave_request_days(request_id,organization_id,employee_id,leave_date,fraction,session) SELECT $1,$2,$3,x.date::date,x.fraction,x.session FROM jsonb_to_recordset($4::jsonb) x(date text,fraction numeric,session text)`,[requestId,organizationId,employee.id,JSON.stringify(days)]);
      for(const {account,allocated} of accounts){
        await client.query(`INSERT INTO leave_request_allocations(request_id,account_id,allocated_days) VALUES($1,$2,$3)`,[requestId,account.id,allocated]);
        if(status==="pending")await client.query(`UPDATE leave_balance_accounts SET pending_days=pending_days+$2,version=version+1 WHERE id=$1`,[account.id,allocated]);
        else await client.query(`UPDATE leave_balance_accounts SET used_days=used_days+$2,version=version+1 WHERE id=$1`,[account.id,allocated]);
        await this.addLedger(client,organizationId,account.id,status==="pending"?"request_hold":"usage",-allocated,requestId,status==="pending"?"Leave request submitted":"Leave auto-approved",userId);
      }
      const snapshot=(await client.query(`SELECT * FROM leave_requests WHERE id=$1`,[requestId])).rows[0];
      await client.query(`INSERT INTO leave_request_history(request_id,organization_id,event_type,after_snapshot,actor_user_id) VALUES($1,$2,$3,$4,$5)`,[requestId,organizationId,status==="approved"?"auto_approved":"submitted",snapshot,userId]);
      if(status==="approved")await this.syncAttendance(client,{id:requestId});
      await client.query("COMMIT");
      return this.findRequest(organizationId,requestId);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }

  requestFilters(organizationId,query,userEmployeeId=null){
    const values=[organizationId],where=["lr.organization_id=$1"];
    if(userEmployeeId){values.push(userEmployeeId);where.push(`lr.employee_id=$${values.length}`);}
    else if(query.employeeId){values.push(query.employeeId);where.push(`lr.employee_id=$${values.length}`);}
    if(query.status!=="all"){values.push(query.status);where.push(`lr.status=$${values.length}`);}
    if(query.leaveTypeId){values.push(query.leaveTypeId);where.push(`lr.leave_type_id=$${values.length}`);}
    if(query.dateFrom){values.push(query.dateFrom);where.push(`lr.end_date>=$${values.length}`);}
    if(query.dateTo){values.push(query.dateTo);where.push(`lr.start_date<=$${values.length}`);}
    if(query.search){values.push(`%${query.search}%`);where.push(`(e.employee_number ILIKE $${values.length} OR CONCAT_WS(' ',e.first_name,e.last_name) ILIKE $${values.length} OR lr.reason ILIKE $${values.length})`);}
    return {values,where:where.join(" AND ")};
  }
  async listRequests(organizationId,query,userId=null){
    let employeeId=null;if(userId){const employee=await this.employeeForUser(this.pool,organizationId,userId);if(!employee)return {items:[],total:0};employeeId=employee.id;}
    const {values,where}=this.requestFilters(organizationId,query,employeeId);
    const count=await this.pool.query(`SELECT COUNT(*)::int total FROM leave_requests lr ${requestJoins} WHERE ${where}`,values);
    values.push(query.pageSize,(query.page-1)*query.pageSize);
    const result=await this.pool.query(`SELECT ${requestColumns} FROM leave_requests lr ${requestJoins} WHERE ${where} ORDER BY CASE lr.status WHEN 'pending' THEN 0 WHEN 'cancel_requested' THEN 1 ELSE 2 END,lr.submitted_at DESC,lr.id LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    return {items:result.rows,total:count.rows[0].total};
  }
  async findRequest(organizationId,id){
    const result=await this.pool.query(`SELECT ${requestColumns} FROM leave_requests lr ${requestJoins} WHERE lr.organization_id=$1 AND lr.id=$2`,[organizationId,id]);
    if(!result.rows[0])return null;
    const [days,history]=await Promise.all([
      this.pool.query(`SELECT TO_CHAR(leave_date,'YYYY-MM-DD') date,fraction::float,session FROM leave_request_days WHERE request_id=$1 ORDER BY leave_date`,[id]),
      this.pool.query(`SELECT h.id,h.event_type AS "eventType",h.before_snapshot AS before,h.after_snapshot AS after,h.occurred_at AS "occurredAt",u.display_name AS "actorName" FROM leave_request_history h LEFT JOIN users u ON u.id=h.actor_user_id WHERE h.request_id=$1 ORDER BY h.occurred_at DESC,h.id DESC`,[id])
    ]);
    return {...result.rows[0],days:days.rows,history:history.rows};
  }
  async applyAllocations(client,organizationId,requestId,transition,actorUserId){
    const allocations=(await client.query(`SELECT a.*,ra.allocated_days::float allocated FROM leave_request_allocations ra JOIN leave_balance_accounts a ON a.id=ra.account_id WHERE ra.request_id=$1 FOR UPDATE OF a`,[requestId])).rows;
    for(const account of allocations){
      const amount=numeric(account.allocated);
      if(transition==="approve")await client.query(`UPDATE leave_balance_accounts SET pending_days=pending_days-$2,used_days=used_days+$2,version=version+1 WHERE id=$1`,[account.id,amount]);
      if(transition==="release")await client.query(`UPDATE leave_balance_accounts SET pending_days=pending_days-$2,version=version+1 WHERE id=$1`,[account.id,amount]);
      if(transition==="reverse")await client.query(`UPDATE leave_balance_accounts SET used_days=used_days-$2,version=version+1 WHERE id=$1`,[account.id,amount]);
      const ledgerType=transition==="approve"?"usage":transition==="reverse"?"usage_reversal":"request_release",ledgerAmount=transition==="approve"?-amount:amount;
      await this.addLedger(client,organizationId,account.id,ledgerType,ledgerAmount,requestId,transition==="approve"?"Leave approved":transition==="reverse"?"Approved leave cancelled":"Leave request released",actorUserId);
    }
  }
  async reviewRequest(organizationId,id,data,actorUserId){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const before=(await client.query(`SELECT * FROM leave_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[organizationId,id])).rows[0];
      if(!before){await client.query("ROLLBACK");return {error:"not_found"};}
      if(before.status!=="pending"){await client.query("ROLLBACK");return {error:"state"};}
      if(before.version!==data.version){await client.query("ROLLBACK");return {error:"version"};}
      await this.applyAllocations(client,organizationId,id,data.decision==="approved"?"approve":"release",actorUserId);
      const after=(await client.query(`UPDATE leave_requests SET status=$3,reviewed_by=$4,reviewer_comment=$5,reviewed_at=NOW(),version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *`,[organizationId,id,data.decision,actorUserId,nullable(data.comment)])).rows[0];
      await client.query(`INSERT INTO leave_request_history(request_id,organization_id,event_type,before_snapshot,after_snapshot,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)`,[id,organizationId,data.decision,before,after,actorUserId]);
      if(data.decision==="approved")await this.syncAttendance(client,{id});
      await client.query("COMMIT");return this.findRequest(organizationId,id);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  async cancelRequest(organizationId,userId,id,data){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const employee=await this.employeeForUser(client,organizationId,userId);
      if(!employee){await client.query("ROLLBACK");return {error:"employee"};}
      const before=(await client.query(`SELECT * FROM leave_requests WHERE organization_id=$1 AND id=$2 AND employee_id=$3 FOR UPDATE`,[organizationId,id,employee.id])).rows[0];
      if(!before){await client.query("ROLLBACK");return {error:"not_found"};}
      if(before.version!==data.version){await client.query("ROLLBACK");return {error:"version"};}
      if(!["pending","approved"].includes(before.status)){await client.query("ROLLBACK");return {error:"state"};}
      const next=before.status==="pending"?"withdrawn":"cancel_requested";
      if(before.status==="pending")await this.applyAllocations(client,organizationId,id,"release",userId);
      const after=(await client.query(`UPDATE leave_requests SET status=$4,cancellation_reason=$5,version=version+1 WHERE organization_id=$1 AND id=$2 AND employee_id=$3 RETURNING *`,[organizationId,id,employee.id,next,data.reason])).rows[0];
      await client.query(`INSERT INTO leave_request_history(request_id,organization_id,event_type,before_snapshot,after_snapshot,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)`,[id,organizationId,next,before,after,userId]);
      await client.query("COMMIT");return this.findRequest(organizationId,id);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  async reviewCancellation(organizationId,id,data,actorUserId){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const before=(await client.query(`SELECT * FROM leave_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`,[organizationId,id])).rows[0];
      if(!before){await client.query("ROLLBACK");return {error:"not_found"};}
      if(before.status!=="cancel_requested"){await client.query("ROLLBACK");return {error:"state"};}
      if(before.version!==data.version){await client.query("ROLLBACK");return {error:"version"};}
      const next=data.decision==="approved"?"cancelled":"approved";
      if(data.decision==="approved"){await this.applyAllocations(client,organizationId,id,"reverse",actorUserId);await this.removeAttendance(client,id);}
      const after=(await client.query(`UPDATE leave_requests SET status=$3,cancellation_reviewed_by=$4,cancellation_comment=$5,cancellation_reviewed_at=NOW(),version=version+1 WHERE organization_id=$1 AND id=$2 RETURNING *`,[organizationId,id,next,actorUserId,nullable(data.comment)])).rows[0];
      await client.query(`INSERT INTO leave_request_history(request_id,organization_id,event_type,before_snapshot,after_snapshot,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)`,[id,organizationId,data.decision==="approved"?"cancellation_approved":"cancellation_rejected",before,after,actorUserId]);
      await client.query("COMMIT");return this.findRequest(organizationId,id);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }

  async balancesForUser(organizationId,userId,year){const employee=await this.employeeForUser(this.pool,organizationId,userId);return employee?this.balancesForEmployee(organizationId,employee.id,year):null;}
  async balancesForEmployee(organizationId,employeeId,year){
    const result=await this.pool.query(`SELECT lt.id AS "leaveTypeId",lt.code AS "leaveTypeCode",lt.name AS "leaveTypeName",lt.color,lt.annual_entitlement_days::float AS entitlement,COALESCE(a.opening_days,lt.annual_entitlement_days)::float AS "openingDays",COALESCE(a.accrued_days,0)::float AS "accruedDays",COALESCE(a.adjusted_days,0)::float AS "adjustedDays",COALESCE(a.carried_forward_days,0)::float AS "carriedForwardDays",COALESCE(a.used_days,0)::float AS "usedDays",COALESCE(a.pending_days,0)::float AS "pendingDays",COALESCE(a.encashed_days,0)::float AS "encashedDays",(COALESCE(a.opening_days,lt.annual_entitlement_days)+COALESCE(a.accrued_days,0)+COALESCE(a.adjusted_days,0)+COALESCE(a.carried_forward_days,0)-COALESCE(a.used_days,0)-COALESCE(a.pending_days,0)-COALESCE(a.encashed_days,0))::float available FROM leave_types lt LEFT JOIN leave_balance_accounts a ON a.leave_type_id=lt.id AND a.employee_id=$2 AND EXTRACT(YEAR FROM a.period_start)=$3 WHERE lt.organization_id=$1 AND lt.status='active' ORDER BY lt.name`,[organizationId,employeeId,year]);
    return result.rows;
  }
  async mySummary(organizationId,userId,year){
    const employee=await this.employeeForUser(this.pool,organizationId,userId);if(!employee)return null;
    const [balances,counts,upcoming]=await Promise.all([
      this.balancesForEmployee(organizationId,employee.id,year),
      this.pool.query(`SELECT COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status='approved')::int approved,COALESCE(SUM(requested_days) FILTER(WHERE status='approved' AND EXTRACT(YEAR FROM start_date)=$3),0)::float "approvedDays" FROM leave_requests WHERE organization_id=$1 AND employee_id=$2`,[organizationId,employee.id,year]),
      this.pool.query(`SELECT ${requestColumns} FROM leave_requests lr ${requestJoins} WHERE lr.organization_id=$1 AND lr.employee_id=$2 AND lr.status IN ('approved','cancel_requested') AND lr.end_date>=CURRENT_DATE ORDER BY lr.start_date LIMIT 5`,[organizationId,employee.id])
    ]);
    return {employee,balances,...counts.rows[0],upcoming:upcoming.rows};
  }
  async listBalances(organizationId,query){
    const values=[organizationId,query.year],where=["e.organization_id=$1","e.archived_at IS NULL","lt.organization_id=$1"];
    if(query.employeeId){values.push(query.employeeId);where.push(`e.id=$${values.length}`);}
    if(query.leaveTypeId){values.push(query.leaveTypeId);where.push(`lt.id=$${values.length}`);}
    if(query.search){values.push(`%${query.search}%`);where.push(`(e.employee_number ILIKE $${values.length} OR CONCAT_WS(' ',e.first_name,e.last_name) ILIKE $${values.length} OR lt.name ILIKE $${values.length})`);}
    const count=await this.pool.query(`SELECT COUNT(*)::int total FROM employees e CROSS JOIN leave_types lt CROSS JOIN (SELECT $2::int AS requested_year) requested_period WHERE ${where.join(" AND ")} AND lt.status='active'`,values);
    values.push(query.pageSize,(query.page-1)*query.pageSize);
    const result=await this.pool.query(`SELECT COALESCE(a.id::text,'') AS "accountId",e.id AS "employeeId",e.employee_number AS "employeeNumber",CONCAT_WS(' ',e.first_name,e.last_name) AS "employeeName",lt.id AS "leaveTypeId",lt.code AS "leaveTypeCode",lt.name AS "leaveTypeName",lt.color AS "leaveTypeColor",COALESCE(a.opening_days,lt.annual_entitlement_days)::float AS "openingDays",COALESCE(a.accrued_days,0)::float AS "accruedDays",COALESCE(a.adjusted_days,0)::float AS "adjustedDays",COALESCE(a.carried_forward_days,0)::float AS "carriedForwardDays",COALESCE(a.used_days,0)::float AS "usedDays",COALESCE(a.pending_days,0)::float AS "pendingDays",COALESCE(a.encashed_days,0)::float AS "encashedDays",(COALESCE(a.opening_days,lt.annual_entitlement_days)+COALESCE(a.accrued_days,0)+COALESCE(a.adjusted_days,0)+COALESCE(a.carried_forward_days,0)-COALESCE(a.used_days,0)-COALESCE(a.pending_days,0)-COALESCE(a.encashed_days,0))::float available,COALESCE(a.version,0) version FROM employees e CROSS JOIN leave_types lt LEFT JOIN leave_balance_accounts a ON a.employee_id=e.id AND a.leave_type_id=lt.id AND EXTRACT(YEAR FROM a.period_start)=$2 WHERE ${where.join(" AND ")} AND lt.status='active' ORDER BY e.first_name,e.last_name,lt.name LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    return {items:result.rows,total:count.rows[0].total};
  }
  async adjustBalance(organizationId,data,actorUserId){
    const client=await this.pool.connect();
    try{
      await client.query("BEGIN");
      const employee=(await client.query(`SELECT id FROM employees WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE`,[organizationId,data.employeeId])).rows[0],type=await this.findType(organizationId,data.leaveTypeId,client);
      if(!employee||!type){await client.query("ROLLBACK");return {error:"reference"};}
      const account=await this.ensureAccount(client,organizationId,employee.id,type,data.year),next=available(account)+data.amountDays;
      if(next<0&&(!type.allowNegativeBalance||next < -type.maximumNegativeDays)){await client.query("ROLLBACK");return {error:"balance",available:available(account)};}
      await client.query(`UPDATE leave_balance_accounts SET adjusted_days=adjusted_days+$2,version=version+1 WHERE id=$1`,[account.id,data.amountDays]);
      const current=(await client.query(`SELECT (opening_days+accrued_days+adjusted_days+carried_forward_days-used_days-pending_days-encashed_days)::float available FROM leave_balance_accounts WHERE id=$1`,[account.id])).rows[0];
      await client.query(`INSERT INTO leave_balance_ledger(organization_id,account_id,transaction_type,amount_days,balance_after,reference_type,notes,actor_user_id) VALUES($1,$2,'adjustment',$3,$4,'manual_adjustment',$5,$6)`,[organizationId,account.id,data.amountDays,current.available,data.reason,actorUserId]);
      await client.query("COMMIT");return {accountId:account.id,available:current.available};
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }

  async listCalendars(organizationId,query){
    const values=[organizationId],where=["hc.organization_id=$1"];
    if(query.search){values.push(`%${query.search}%`);where.push(`hc.name ILIKE $${values.length}`);}
    if(query.status!=="all"){values.push(query.status);where.push(`hc.status=$${values.length}`);}
    const count=await this.pool.query(`SELECT COUNT(*)::int total FROM holiday_calendars hc WHERE ${where.join(" AND ")}`,values);values.push(query.pageSize,(query.page-1)*query.pageSize);
    const result=await this.pool.query(`SELECT hc.id,hc.name,hc.description,hc.timezone,hc.is_default AS "isDefault",hc.status,hc.version,COUNT(DISTINCT h.id)::int AS "holidayCount",COALESCE(JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('id',wl.id,'name',wl.name)) FILTER(WHERE wl.id IS NOT NULL),'[]') AS locations FROM holiday_calendars hc LEFT JOIN holidays h ON h.calendar_id=hc.id LEFT JOIN holiday_calendar_locations hcl ON hcl.calendar_id=hc.id LEFT JOIN work_locations wl ON wl.id=hcl.work_location_id WHERE ${where.join(" AND ")} GROUP BY hc.id ORDER BY hc.is_default DESC,hc.name LIMIT $${values.length-1} OFFSET $${values.length}`,values);return {items:result.rows,total:count.rows[0].total};
  }
  async findCalendar(organizationId,id){return (await this.pool.query(`SELECT hc.id,hc.name,hc.description,hc.timezone,hc.is_default AS "isDefault",hc.status,hc.version,COALESCE(ARRAY_AGG(hcl.work_location_id) FILTER(WHERE hcl.work_location_id IS NOT NULL),'{}') AS "locationIds" FROM holiday_calendars hc LEFT JOIN holiday_calendar_locations hcl ON hcl.calendar_id=hc.id WHERE hc.organization_id=$1 AND hc.id=$2 GROUP BY hc.id`,[organizationId,id])).rows[0]||null;}
  async validateLocations(client,organizationId,locationIds){if(!locationIds.length)return true;const result=await client.query(`SELECT COUNT(*)::int count FROM work_locations WHERE organization_id=$1 AND id=ANY($2::uuid[])`,[organizationId,locationIds]);return result.rows[0].count===locationIds.length;}
  async createCalendar(organizationId,data,actorUserId){
    const client=await this.pool.connect();try{await client.query("BEGIN");if(!await this.validateLocations(client,organizationId,data.locationIds)){await client.query("ROLLBACK");return {error:"location"};}if(data.isDefault)await client.query(`UPDATE holiday_calendars SET is_default=FALSE WHERE organization_id=$1`,[organizationId]);const result=await client.query(`INSERT INTO holiday_calendars(organization_id,name,description,timezone,is_default,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,[organizationId,data.name,nullable(data.description),data.timezone,data.isDefault,data.status,actorUserId]);for(const locationId of data.locationIds)await client.query(`INSERT INTO holiday_calendar_locations(calendar_id,organization_id,work_location_id) VALUES($1,$2,$3)`,[result.rows[0].id,organizationId,locationId]);await client.query("COMMIT");return this.findCalendar(organizationId,result.rows[0].id);}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  async updateCalendar(organizationId,id,data,actorUserId){
    const client=await this.pool.connect();try{await client.query("BEGIN");if(data.locationIds&&!await this.validateLocations(client,organizationId,data.locationIds)){await client.query("ROLLBACK");return {error:"location"};}if(data.isDefault)await client.query(`UPDATE holiday_calendars SET is_default=FALSE WHERE organization_id=$1 AND id<>$2`,[organizationId,id]);const mapping={name:"name",description:"description",timezone:"timezone",isDefault:"is_default",status:"status"},values=[organizationId,id,data.version],sets=[];for(const [key,column] of Object.entries(mapping))if(has(data,key)){values.push(nullable(data[key]));sets.push(`${column}=$${values.length}`);}values.push(actorUserId);sets.push(`updated_by=$${values.length}`,"version=version+1");const result=await client.query(`UPDATE holiday_calendars SET ${sets.join(",")} WHERE organization_id=$1 AND id=$2 AND version=$3 RETURNING id`,values);if(!result.rowCount){await client.query("ROLLBACK");return null;}if(data.locationIds){await client.query(`DELETE FROM holiday_calendar_locations WHERE calendar_id=$1`,[id]);for(const locationId of data.locationIds)await client.query(`INSERT INTO holiday_calendar_locations(calendar_id,organization_id,work_location_id) VALUES($1,$2,$3)`,[id,organizationId,locationId]);}await client.query("COMMIT");return this.findCalendar(organizationId,id);}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }
  async listHolidays(organizationId,query){const values=[organizationId],where=["h.organization_id=$1"];if(query.calendarId){values.push(query.calendarId);where.push(`h.calendar_id=$${values.length}`);}if(query.dateFrom){values.push(query.dateFrom);where.push(`h.holiday_date>=$${values.length}`);}if(query.dateTo){values.push(query.dateTo);where.push(`h.holiday_date<=$${values.length}`);}if(query.search){values.push(`%${query.search}%`);where.push(`h.name ILIKE $${values.length}`);}const count=await this.pool.query(`SELECT COUNT(*)::int total FROM holidays h WHERE ${where.join(" AND ")}`,values);values.push(query.pageSize,(query.page-1)*query.pageSize);const result=await this.pool.query(`SELECT h.id,h.calendar_id AS "calendarId",hc.name AS "calendarName",h.name,TO_CHAR(h.holiday_date,'YYYY-MM-DD') AS "holidayDate",h.is_optional AS "isOptional",h.description,h.version FROM holidays h JOIN holiday_calendars hc ON hc.id=h.calendar_id WHERE ${where.join(" AND ")} ORDER BY h.holiday_date,h.name LIMIT $${values.length-1} OFFSET $${values.length}`,values);return {items:result.rows,total:count.rows[0].total};}
  async createHoliday(organizationId,data,actorUserId){const result=await this.pool.query(`INSERT INTO holidays(organization_id,calendar_id,name,holiday_date,is_optional,description,created_by,updated_by) SELECT $1,hc.id,$3,$4,$5,$6,$7,$7 FROM holiday_calendars hc WHERE hc.organization_id=$1 AND hc.id=$2 RETURNING id`,[organizationId,data.calendarId,data.name,data.holidayDate,data.isOptional,nullable(data.description),actorUserId]);return result.rows[0]||{error:"calendar"};}
  async updateHoliday(organizationId,id,data,actorUserId){const mapping={name:"name",holidayDate:"holiday_date",isOptional:"is_optional",description:"description"},values=[organizationId,id,data.version],sets=[];for(const [key,column] of Object.entries(mapping))if(has(data,key)){values.push(nullable(data[key]));sets.push(`${column}=$${values.length}`);}values.push(actorUserId);sets.push(`updated_by=$${values.length}`,"version=version+1");const result=await this.pool.query(`UPDATE holidays SET ${sets.join(",")} WHERE organization_id=$1 AND id=$2 AND version=$3 RETURNING id`,values);return result.rows[0]||null;}

  async teamCalendar(organizationId,query){const values=[organizationId,query.dateFrom,query.dateTo],where=["d.organization_id=$1","d.leave_date BETWEEN $2 AND $3","lr.status IN ('approved','cancel_requested')"];if(query.leaveTypeId){values.push(query.leaveTypeId);where.push(`lr.leave_type_id=$${values.length}`);}if(query.search){values.push(`%${query.search}%`);where.push(`(e.employee_number ILIKE $${values.length} OR CONCAT_WS(' ',e.first_name,e.last_name) ILIKE $${values.length})`);}const count=await this.pool.query(`SELECT COUNT(*)::int total FROM leave_request_days d JOIN leave_requests lr ON lr.id=d.request_id JOIN employees e ON e.id=d.employee_id WHERE ${where.join(" AND ")}`,values);values.push(query.pageSize,(query.page-1)*query.pageSize);const result=await this.pool.query(`SELECT d.request_id AS "requestId",TO_CHAR(d.leave_date,'YYYY-MM-DD') date,d.fraction::float,d.session,e.id AS "employeeId",e.employee_number AS "employeeNumber",CONCAT_WS(' ',e.first_name,e.last_name) AS "employeeName",dep.name AS "departmentName",lt.id AS "leaveTypeId",lt.name AS "leaveTypeName",lt.color FROM leave_request_days d JOIN leave_requests lr ON lr.id=d.request_id JOIN employees e ON e.id=d.employee_id LEFT JOIN departments dep ON dep.id=e.department_id JOIN leave_types lt ON lt.id=lr.leave_type_id WHERE ${where.join(" AND ")} ORDER BY d.leave_date,e.first_name LIMIT $${values.length-1} OFFSET $${values.length}`,values);return {items:result.rows,total:count.rows[0].total};}
  async reportSummary(organizationId,query){const {values,where}=this.requestFilters(organizationId,{...query,page:1,pageSize:1,employeeId:null,search:query.search||""});const totals=await this.pool.query(`SELECT COUNT(*)::int requests,COALESCE(SUM(lr.requested_days),0)::float days,COUNT(*) FILTER(WHERE lr.status='pending')::int pending,COUNT(*) FILTER(WHERE lr.status='approved')::int approved,COUNT(*) FILTER(WHERE lr.status='rejected')::int rejected FROM leave_requests lr ${requestJoins} WHERE ${where}`,values);const byType=await this.pool.query(`SELECT lt.id,lt.name,lt.color,COUNT(*)::int requests,COALESCE(SUM(lr.requested_days),0)::float days FROM leave_requests lr JOIN leave_types lt ON lt.id=lr.leave_type_id JOIN employees e ON e.id=lr.employee_id LEFT JOIN employees handover ON FALSE LEFT JOIN users reviewer ON FALSE LEFT JOIN users cancel_reviewer ON FALSE WHERE ${where} GROUP BY lt.id ORDER BY days DESC`,values);return {...totals.rows[0],byType:byType.rows};}
}

module.exports={LeaveRepository};
