import {useState,type CSSProperties,type FormEvent} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {
  Archive,Briefcase,Cake,CalendarCheck,CaretLeft,CaretRight,CheckCircle,ClockCounterClockwise,DownloadSimple,
  EnvelopeSimple,FileText,IdentificationCard,List,LockKey,MagnifyingGlass,MapPin,Palette,PencilSimple,Phone,Plus,
  TreeStructure,Trash,UserCircle,UsersThree,WarningCircle,X
} from "@phosphor-icons/react";
import {useAuth} from "../features/auth/AuthProvider";
import {
  employeeApi,type DirectoryEmployee,type EmployeeDetail,type EmployeeMetadata,type EmploymentStatus
} from "../features/employees/employee.api";

const humanize=(value:string|null|undefined)=>value?value.replaceAll("_"," ").replace(/\b\w/g,letter=>letter.toUpperCase()):"Not set";
const today=()=>new Date().toISOString().slice(0,10);
const apiError=(error:unknown)=>(error as {response?:{data?:{error?:{message?:string}}}}).response?.data?.error?.message||"The change could not be saved.";
type TreeEmployee=DirectoryEmployee&{reports:TreeEmployee[]};

type FormState={
  employeeNumber:string;firstName:string;middleName:string;lastName:string;preferredName:string;userId:string;
  workEmail:string;personalEmail:string;workPhone:string;personalPhone:string;dateOfBirth:string;gender:string;
  pronouns:string;maritalStatus:string;bloodGroup:string;nationality:string;profilePhotoUrl:string;biography:string;
  employmentStatus:string;employmentType:string;workMode:string;joinDate:string;probationEndDate:string;confirmationDate:string;
  probationPeriodDays:string;noticePeriodDays:string;benefitsEligible:boolean;
  departmentId:string;jobTitleId:string;workLocationId:string;managerEmployeeId:string;costCenter:string;timezone:string;
  addressLine1:string;addressLine2:string;city:string;state:string;postalCode:string;country:string;
  emergencyName:string;emergencyRelationship:string;emergencyPhone:string;emergencyEmail:string;changeReason:string;
};

const initialForm=(employee?:EmployeeDetail):FormState=>({
  employeeNumber:employee?.employeeNumber||"",firstName:employee?.firstName||"",middleName:employee?.middleName||"",
  lastName:employee?.lastName||"",preferredName:employee?.preferredName||"",userId:employee?.userId||"",
  workEmail:employee?.workEmail||"",personalEmail:employee?.personalEmail||"",workPhone:employee?.workPhone||"",
  personalPhone:employee?.personalPhone||"",dateOfBirth:employee?.dateOfBirth||"",gender:employee?.gender||"",
  pronouns:employee?.pronouns||"",maritalStatus:employee?.maritalStatus||"",bloodGroup:employee?.bloodGroup||"",
  nationality:employee?.nationality||"IN",profilePhotoUrl:employee?.profilePhotoUrl||"",biography:employee?.biography||"",
  employmentStatus:employee?.employmentStatus||"preboarding",employmentType:employee?.employmentType||"full_time",
  workMode:employee?.workMode||"onsite",joinDate:employee?.joinDate||today(),probationEndDate:employee?.probationEndDate||"",
  confirmationDate:employee?.confirmationDate||"",probationPeriodDays:String(employee?.probationPeriodDays??90),noticePeriodDays:String(employee?.noticePeriodDays??30),benefitsEligible:employee?.benefitsEligible??false,departmentId:employee?.departmentId||"",jobTitleId:employee?.jobTitleId||"",
  workLocationId:employee?.workLocationId||"",managerEmployeeId:employee?.managerEmployeeId||"",
  costCenter:employee?.costCenter||"",timezone:employee?.timezone||"Asia/Kolkata",
  addressLine1:employee?.addresses[0]?.line1||"",addressLine2:employee?.addresses[0]?.line2||"",
  city:employee?.addresses[0]?.city||"",state:employee?.addresses[0]?.state||"",postalCode:employee?.addresses[0]?.postalCode||"",
  country:employee?.addresses[0]?.country||"IN",emergencyName:employee?.emergencyContacts[0]?.name||"",
  emergencyRelationship:employee?.emergencyContacts[0]?.relationship||"",emergencyPhone:employee?.emergencyContacts[0]?.phone||"",
  emergencyEmail:employee?.emergencyContacts[0]?.email||"",changeReason:""
});

function EmployeeEditor({metadata,employee,suggestedNumber,onClose}:{metadata:EmployeeMetadata;employee?:EmployeeDetail;suggestedNumber?:string;onClose:()=>void}){
  const queryClient=useQueryClient();
  const [form,setForm]=useState<FormState>(()=>{const value=initialForm(employee);if(!employee&&suggestedNumber)value.employeeNumber=suggestedNumber;return value;});
  const [section,setSection]=useState<"identity"|"work"|"contact">("identity");
  const [error,setError]=useState("");
  const set=(key:keyof FormState,value:string)=>setForm(current=>({...current,[key]:value}));
  const optional=(value:string)=>value||null;
  const mutation=useMutation({
    mutationFn:()=>{
      const payload:Record<string,unknown>={
        employeeNumber:form.employeeNumber,firstName:form.firstName,middleName:optional(form.middleName),lastName:form.lastName,
        preferredName:optional(form.preferredName),userId:optional(form.userId),workEmail:optional(form.workEmail),
        personalEmail:optional(form.personalEmail),workPhone:optional(form.workPhone),personalPhone:optional(form.personalPhone),
        dateOfBirth:optional(form.dateOfBirth),gender:optional(form.gender),pronouns:optional(form.pronouns),
        maritalStatus:optional(form.maritalStatus),bloodGroup:optional(form.bloodGroup),nationality:optional(form.nationality),
        profilePhotoUrl:optional(form.profilePhotoUrl),biography:optional(form.biography),employmentType:form.employmentType,
        workMode:form.workMode,joinDate:form.joinDate,probationEndDate:optional(form.probationEndDate),
        confirmationDate:optional(form.confirmationDate),probationPeriodDays:Number(form.probationPeriodDays),noticePeriodDays:Number(form.noticePeriodDays),benefitsEligible:form.benefitsEligible,departmentId:optional(form.departmentId),jobTitleId:optional(form.jobTitleId),
        workLocationId:optional(form.workLocationId),managerEmployeeId:optional(form.managerEmployeeId),costCenter:optional(form.costCenter),
        timezone:optional(form.timezone),addresses:form.addressLine1&&form.city?[{addressType:"current",line1:form.addressLine1,
          line2:optional(form.addressLine2),city:form.city,state:optional(form.state),postalCode:optional(form.postalCode),
          country:form.country,isPrimary:true}]:[],emergencyContacts:form.emergencyName&&form.emergencyRelationship&&form.emergencyPhone?
          [{name:form.emergencyName,relationship:form.emergencyRelationship,phone:form.emergencyPhone,email:optional(form.emergencyEmail),isPrimary:true}]:[]
      };
      if(employee)return employeeApi.update(employee.id,{...payload,version:employee.version,effectiveDate:today(),changeReason:optional(form.changeReason)});
      return employeeApi.create({...payload,employmentStatus:form.employmentStatus});
    },
    onSuccess:()=>{queryClient.invalidateQueries({queryKey:["employees"]});queryClient.invalidateQueries({queryKey:["employee-summary"]});queryClient.invalidateQueries({queryKey:["employee-metadata"]});onClose();},
    onError:error=>setError(apiError(error))
  });
  const submit=(event:FormEvent)=>{event.preventDefault();setError("");mutation.mutate();};
  return <div className="editor-layer employee-editor-layer"><form className="employee-editor" onSubmit={submit}>
    <header><div><span>EMPLOYEE RECORD</span><h2>{employee?`Edit ${employee.fullName}`:"Add an employee"}</h2><p>Maintain one reliable profile across HR workflows.</p></div><button type="button" className="icon-button" onClick={onClose}><X/><span className="sr-only">Close</span></button></header>
    <nav className="employee-editor-tabs">
      <button type="button" className={section==="identity"?"active":""} onClick={()=>setSection("identity")}><UserCircle/>Identity</button>
      <button type="button" className={section==="work"?"active":""} onClick={()=>setSection("work")}><Briefcase/>Employment</button>
      <button type="button" className={section==="contact"?"active":""} onClick={()=>setSection("contact")}><Phone/>Contact & emergency</button>
    </nav>
    <div className="employee-editor-body">
      {section==="identity"&&<div className="employee-form-grid">
        <label>Employee number<input required value={form.employeeNumber} onChange={e=>set("employeeNumber",e.target.value.toUpperCase())} placeholder="RW-0002"/></label>
        <label>Linked login account<select value={form.userId} onChange={e=>set("userId",e.target.value)}><option value="">No login account</option>{employee?.userId&&<option value={employee.userId}>Current linked account</option>}{metadata.availableUsers.map(user=><option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}</select></label>
        <label>First name<input required value={form.firstName} onChange={e=>set("firstName",e.target.value)}/></label>
        <label>Middle name<input value={form.middleName} onChange={e=>set("middleName",e.target.value)}/></label>
        <label>Last name<input required value={form.lastName} onChange={e=>set("lastName",e.target.value)}/></label>
        <label>Preferred name<input value={form.preferredName} onChange={e=>set("preferredName",e.target.value)}/></label>
        <label>Date of birth<input type="date" value={form.dateOfBirth} max={today()} onChange={e=>set("dateOfBirth",e.target.value)}/></label>
        <label>Gender<select value={form.gender} onChange={e=>set("gender",e.target.value)}><option value="">Not specified</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="self_described">Self-described</option><option value="prefer_not_to_say">Prefer not to say</option></select></label>
        <label>Pronouns<input value={form.pronouns} onChange={e=>set("pronouns",e.target.value)}/></label>
        <label>Marital status<select value={form.maritalStatus} onChange={e=>set("maritalStatus",e.target.value)}><option value="">Not specified</option>{["single","married","domestic_partnership","separated","divorced","widowed","prefer_not_to_say"].map(value=><option key={value} value={value}>{humanize(value)}</option>)}</select></label>
        <label>Blood group<input value={form.bloodGroup} onChange={e=>set("bloodGroup",e.target.value.toUpperCase())}/></label>
        <label>Nationality<input value={form.nationality} maxLength={2} onChange={e=>set("nationality",e.target.value.toUpperCase())}/></label>
        <label className="form-span-two">Profile photo URL<input type="url" value={form.profilePhotoUrl} onChange={e=>set("profilePhotoUrl",e.target.value)}/></label>
        <label className="form-span-two">Biography<textarea value={form.biography} maxLength={1000} onChange={e=>set("biography",e.target.value)}/></label>
      </div>}
      {section==="work"&&<div className="employee-form-grid">
        {!employee&&<label>Starting status<select value={form.employmentStatus} onChange={e=>set("employmentStatus",e.target.value)}><option value="preboarding">Preboarding</option><option value="probation">Probation</option><option value="active">Active</option></select></label>}
        <label>Employment type<select required value={form.employmentType} onChange={e=>set("employmentType",e.target.value)}>{["full_time","part_time","contract","intern","temporary","apprentice"].map(value=><option value={value} key={value}>{humanize(value)}</option>)}</select></label>
        <label>Work mode<select value={form.workMode} onChange={e=>set("workMode",e.target.value)}>{["onsite","hybrid","remote"].map(value=><option value={value} key={value}>{humanize(value)}</option>)}</select></label>
        <label>Join date<input required type="date" value={form.joinDate} onChange={e=>set("joinDate",e.target.value)}/></label>
        <label>Probation end<input type="date" min={form.joinDate} value={form.probationEndDate} onChange={e=>set("probationEndDate",e.target.value)}/></label>
        <label>Confirmation date<input type="date" min={form.joinDate} value={form.confirmationDate} onChange={e=>set("confirmationDate",e.target.value)}/></label>
        <label>Probation period (days)<input type="number" min="0" max="730" value={form.probationPeriodDays} onChange={e=>set("probationPeriodDays",e.target.value)}/></label>
        <label>Notice period (days)<input type="number" min="0" max="730" value={form.noticePeriodDays} onChange={e=>set("noticePeriodDays",e.target.value)}/></label>
        <label className="employee-check"><input type="checkbox" checked={form.benefitsEligible} onChange={e=>setForm(current=>({...current,benefitsEligible:e.target.checked}))}/><span>Eligible for employee benefits</span></label>
        <label>Department<select value={form.departmentId} onChange={e=>set("departmentId",e.target.value)}><option value="">Unassigned</option>{metadata.departments.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Job title<select value={form.jobTitleId} onChange={e=>set("jobTitleId",e.target.value)}><option value="">Unassigned</option>{metadata.jobTitles.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Work location<select value={form.workLocationId} onChange={e=>set("workLocationId",e.target.value)}><option value="">Unassigned</option>{metadata.workLocations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Reports to<select value={form.managerEmployeeId} onChange={e=>set("managerEmployeeId",e.target.value)}><option value="">No manager</option>{metadata.managers.filter(item=>item.id!==employee?.id).map(item=><option key={item.id} value={item.id}>{item.name} · {item.employeeNumber}</option>)}</select></label>
        <label>Cost center<input value={form.costCenter} onChange={e=>set("costCenter",e.target.value)}/></label>
        <label>Timezone<input value={form.timezone} onChange={e=>set("timezone",e.target.value)}/></label>
        {employee&&<label className="form-span-two">Reason for employment change<input value={form.changeReason} onChange={e=>set("changeReason",e.target.value)} placeholder="Promotion, transfer, manager change…"/></label>}
      </div>}
      {section==="contact"&&<div className="employee-form-grid">
        <label>Work email<input type="email" value={form.workEmail} onChange={e=>set("workEmail",e.target.value)}/></label>
        <label>Work phone<input value={form.workPhone} onChange={e=>set("workPhone",e.target.value)}/></label>
        <label>Personal email<input type="email" value={form.personalEmail} onChange={e=>set("personalEmail",e.target.value)}/></label>
        <label>Personal phone<input value={form.personalPhone} onChange={e=>set("personalPhone",e.target.value)}/></label>
        <h3 className="form-span-two">Primary current address</h3>
        <label className="form-span-two">Address line 1<input value={form.addressLine1} onChange={e=>set("addressLine1",e.target.value)}/></label>
        <label className="form-span-two">Address line 2<input value={form.addressLine2} onChange={e=>set("addressLine2",e.target.value)}/></label>
        <label>City<input value={form.city} onChange={e=>set("city",e.target.value)}/></label><label>State<input value={form.state} onChange={e=>set("state",e.target.value)}/></label>
        <label>Postal code<input value={form.postalCode} onChange={e=>set("postalCode",e.target.value)}/></label><label>Country code<input value={form.country} maxLength={2} onChange={e=>set("country",e.target.value.toUpperCase())}/></label>
        <h3 className="form-span-two">Primary emergency contact</h3>
        <label>Name<input value={form.emergencyName} onChange={e=>set("emergencyName",e.target.value)}/></label><label>Relationship<input value={form.emergencyRelationship} onChange={e=>set("emergencyRelationship",e.target.value)}/></label>
        <label>Emergency phone<input value={form.emergencyPhone} onChange={e=>set("emergencyPhone",e.target.value)}/></label><label>Emergency email<input type="email" value={form.emergencyEmail} onChange={e=>set("emergencyEmail",e.target.value)}/></label>
      </div>}
      {error&&<p className="form-error"><WarningCircle/>{error}</p>}
    </div>
    <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={mutation.isPending}>{mutation.isPending?"Saving…":employee?"Save changes":"Create employee"}</button></footer>
  </form></div>;
}

function ProtectedRecords({employee}:{employee:EmployeeDetail}){
  const queryClient=useQueryClient();const [identifier,setIdentifier]=useState({identifierType:"",identifierValue:"",country:"IN",expiresOn:""});const [document,setDocument]=useState({documentType:"",fileName:"",fileUrl:"",mimeType:"application/pdf",expiresOn:""});const [error,setError]=useState("");
  const refresh=()=>{queryClient.invalidateQueries({queryKey:["employee",employee.id]});queryClient.invalidateQueries({queryKey:["employee-history",employee.id]});};
  const addIdentifier=useMutation({mutationFn:()=>employeeApi.addIdentifier(employee.id,{...identifier,expiresOn:identifier.expiresOn||null}),onSuccess:()=>{setIdentifier({identifierType:"",identifierValue:"",country:"IN",expiresOn:""});setError("");refresh();},onError:error=>setError(apiError(error))});
  const addDocument=useMutation({mutationFn:()=>employeeApi.addDocument(employee.id,{...document,sizeBytes:null,expiresOn:document.expiresOn||null}),onSuccess:()=>{setDocument({documentType:"",fileName:"",fileUrl:"",mimeType:"application/pdf",expiresOn:""});setError("");refresh();},onError:error=>setError(apiError(error))});
  return <section className="protected-records"><h3><LockKey/>Protected identity records</h3><div className="protected-list">{employee.identifiers.map(item=><div key={item.id}><p><strong>{humanize(item.identifierType)}</strong><small>{item.maskedValue} · {item.country}</small></p><button onClick={()=>employeeApi.removeIdentifier(employee.id,item.id).then(refresh)}><Trash/></button></div>)}{!employee.identifiers.length&&<p>No protected identifiers recorded.</p>}</div><form onSubmit={event=>{event.preventDefault();addIdentifier.mutate();}}><input aria-label="Identifier type" required placeholder="Identifier type" value={identifier.identifierType} onChange={event=>setIdentifier({...identifier,identifierType:event.target.value.toLowerCase().replaceAll(" ","_")})}/><input aria-label="Identifier value" required placeholder="Identifier value" value={identifier.identifierValue} onChange={event=>setIdentifier({...identifier,identifierValue:event.target.value})}/><input aria-label="Identifier country" required maxLength={2} value={identifier.country} onChange={event=>setIdentifier({...identifier,country:event.target.value.toUpperCase()})}/><button className="secondary-button">Protect identifier</button></form><h3><FileText/>Document links</h3><div className="protected-list">{employee.documents.map(item=><div key={item.id}><p><strong>{humanize(item.documentType)}</strong><small><a href={item.fileUrl} target="_blank" rel="noreferrer">{item.fileName}</a></small></p><button onClick={()=>employeeApi.removeDocument(employee.id,item.id).then(refresh)}><Trash/></button></div>)}{!employee.documents.length&&<p>No document links recorded.</p>}</div><form onSubmit={event=>{event.preventDefault();addDocument.mutate();}}><input aria-label="Document type" required placeholder="Document type" value={document.documentType} onChange={event=>setDocument({...document,documentType:event.target.value.toLowerCase().replaceAll(" ","_")})}/><input aria-label="Document name" required placeholder="File name" value={document.fileName} onChange={event=>setDocument({...document,fileName:event.target.value})}/><input aria-label="Document URL" required type="url" placeholder="Secure HTTPS URL" value={document.fileUrl} onChange={event=>setDocument({...document,fileUrl:event.target.value})}/><select aria-label="Document MIME type" value={document.mimeType} onChange={event=>setDocument({...document,mimeType:event.target.value})}><option value="application/pdf">PDF</option><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select><button className="secondary-button">Add document</button></form>{error&&<p className="form-error">{error}</p>}</section>;
}

function StatusEditor({employee,onClose}:{employee:EmployeeDetail;onClose:()=>void}){
  const queryClient=useQueryClient();const [status,setStatus]=useState<EmploymentStatus>(employee.employmentStatus);const [effectiveDate,setEffectiveDate]=useState(today());const [reason,setReason]=useState("");const [error,setError]=useState("");
  const mutation=useMutation({mutationFn:()=>employeeApi.changeStatus(employee.id,{status,effectiveDate,reason,version:employee.version}),onSuccess:()=>{queryClient.invalidateQueries({queryKey:["employees"]});queryClient.invalidateQueries({queryKey:["employee",employee.id]});queryClient.invalidateQueries({queryKey:["employee-history",employee.id]});queryClient.invalidateQueries({queryKey:["employee-summary"]});onClose();},onError:error=>setError(apiError(error))});
  return <div className="status-dialog"><form onSubmit={event=>{event.preventDefault();mutation.mutate();}}><header><div><span>LIFECYCLE CHANGE</span><h3>Update employment status</h3></div><button type="button" onClick={onClose}><X/></button></header><label>New status<select value={status} onChange={e=>setStatus(e.target.value as EmploymentStatus)}>{["preboarding","probation","active","on_leave","notice_period","suspended","terminated"].map(value=><option key={value} value={value}>{humanize(value)}</option>)}</select></label><label>Effective date<input required type="date" value={effectiveDate} onChange={e=>setEffectiveDate(e.target.value)}/></label><label>Reason<textarea required={status==="terminated"} value={reason} onChange={e=>setReason(e.target.value)}/></label>{error&&<p className="form-error">{error}</p>}<footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={status===employee.employmentStatus||mutation.isPending}>Apply status</button></footer></form></div>;
}

function BulkEmployeeEditor({employeeIds,metadata,onClose}:{employeeIds:string[];metadata:EmployeeMetadata;onClose:()=>void}){
  const queryClient=useQueryClient();const [field,setField]=useState("departmentId");const [value,setValue]=useState("");const [effectiveDate,setEffectiveDate]=useState(today());const [reason,setReason]=useState("");const [error,setError]=useState("");
  const choices=field==="departmentId"?metadata.departments:field==="jobTitleId"?metadata.jobTitles:field==="workLocationId"?metadata.workLocations:field==="managerEmployeeId"?metadata.managers:[];
  const mutation=useMutation({mutationFn:()=>employeeApi.bulkUpdate({employeeIds,[field]:value||null,effectiveDate,changeReason:reason}),onSuccess:()=>{queryClient.invalidateQueries({queryKey:["employees"]});queryClient.invalidateQueries({queryKey:["employee-metadata"]});onClose();},onError:error=>setError(apiError(error))});
  return <div className="status-dialog bulk-dialog"><form onSubmit={event=>{event.preventDefault();mutation.mutate();}}><header><div><span>BULK ASSIGNMENT</span><h3>Update {employeeIds.length} employees</h3></div><button type="button" onClick={onClose}><X/></button></header><label>Field<select value={field} onChange={event=>{setField(event.target.value);setValue("");}}><option value="departmentId">Department</option><option value="jobTitleId">Job title</option><option value="workLocationId">Work location</option><option value="managerEmployeeId">Reporting manager</option><option value="employmentType">Employment type</option><option value="workMode">Work mode</option></select></label><label>New value<select required={field!=="managerEmployeeId"} value={value} onChange={event=>setValue(event.target.value)}><option value="">{field==="managerEmployeeId"?"No manager":"Select a value"}</option>{["employmentType","workMode"].includes(field)?(field==="employmentType"?["full_time","part_time","contract","intern","temporary","apprentice"]:["onsite","hybrid","remote"]).map(item=><option value={item} key={item}>{humanize(item)}</option>):choices.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Effective date<input required type="date" value={effectiveDate} onChange={event=>setEffectiveDate(event.target.value)}/></label><label>Reason<textarea required minLength={2} value={reason} onChange={event=>setReason(event.target.value)}/></label>{error&&<p className="form-error">{error}</p>}<footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={mutation.isPending}>Apply to {employeeIds.length}</button></footer></form></div>;
}

function TreeNode({employee,depth=0,onOpen}:{employee:TreeEmployee;depth?:number;onOpen:(id:string)=>void}){
  return <div className="tree-branch" style={{"--tree-depth":depth} as CSSProperties}><button onClick={()=>onOpen(employee.id)}><i>{employee.firstName[0]}{employee.lastName[0]}</i><span><strong>{employee.fullName}</strong><small>{employee.jobTitleName||"Team member"} · {employee.departmentName||"No department"}</small></span></button>{employee.reports?.length>0&&<div>{employee.reports.map(report=><TreeNode employee={report} depth={depth+1} onOpen={onOpen} key={report.id}/>)}</div>}</div>;
}

function EmployeeTree({items,onOpen}:{items:TreeEmployee[];onOpen:(id:string)=>void}){
  return <section className="employee-insight-card"><header><TreeStructure/><div><h2>Organization tree</h2><p>Current reporting relationships across active employees.</p></div></header><div className="organization-tree">{items.map(employee=><TreeNode employee={employee} onOpen={onOpen} key={employee.id}/>)}{!items.length&&<p className="directory-message">No reporting hierarchy is available.</p>}</div></section>;
}

function EmployeeEvents({items,onOpen}:{items:Array<{type:string;date:string;employeeId:string;employeeNumber:string;name:string}>;onOpen:(id:string)=>void}){
  return <section className="employee-insight-card"><header><Cake/><div><h2>Upcoming people events</h2><p>Birthdays, work anniversaries and probation completion dates.</p></div></header><div className="event-list">{items.map((item,index)=><button key={`${item.employeeId}-${item.type}-${index}`} onClick={()=>onOpen(item.employeeId)}><time><strong>{new Date(`${item.date}T00:00:00`).getDate()}</strong>{new Date(`${item.date}T00:00:00`).toLocaleString(undefined,{month:"short"})}</time><p><strong>{item.name}</strong><small>{humanize(item.type)} · {item.employeeNumber}</small></p></button>)}{!items.length&&<p className="directory-message">No events are due in this period.</p>}</div></section>;
}

function EmployeeProfile({employeeId,onClose,onEdit}:{employeeId:string;onClose:()=>void;onEdit:(employee:EmployeeDetail)=>void}){
  const {hasPermission}=useAuth();
  const queryClient=useQueryClient();const [tab,setTab]=useState<"overview"|"personal"|"history">("overview");const [statusOpen,setStatusOpen]=useState(false);
  const detail=useQuery({queryKey:["employee",employeeId],queryFn:()=>employeeApi.get(employeeId)});
  const history=useQuery({queryKey:["employee-history",employeeId],queryFn:()=>employeeApi.history(employeeId),enabled:tab==="history"});
  const employee=detail.data;
  const archiveMutation=useMutation({mutationFn:()=>employeeApi.archive(employeeId,{version:employee!.version,reason:"Archived by an administrator"}),onSuccess:()=>{queryClient.invalidateQueries({queryKey:["employees"]});queryClient.invalidateQueries({queryKey:["employee-summary"]});onClose();}});
  const reopenMutation=useMutation({mutationFn:()=>employeeApi.reopenProfile(employeeId,employee!.version),onSuccess:()=>queryClient.invalidateQueries({queryKey:["employee",employeeId]})});
  return <div className="profile-layer" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><aside className="employee-profile">
    <header><button className="icon-button" onClick={onClose}><X/></button>{employee&&<><div className="profile-avatar">{employee.profilePhotoUrl?<img src={employee.profilePhotoUrl} alt=""/>:<span>{employee.firstName[0]}{employee.lastName[0]}</span>}</div><h2>{employee.fullName}</h2><p>{employee.jobTitleName||"Team member"} · {employee.employeeNumber}</p><i className={`employee-status ${employee.employmentStatus}`}>{humanize(employee.employmentStatus)}</i><div className="profile-actions">{hasPermission("employees.manage")&&<button onClick={()=>onEdit(employee)}><PencilSimple/>Edit profile</button>}{hasPermission("employees.lifecycle.manage")&&<button onClick={()=>setStatusOpen(true)}><ClockCounterClockwise/>Change status</button>}{hasPermission("employees.lifecycle.manage")&&employee.profileCompleted&&<button onClick={()=>reopenMutation.mutate()}><UserCircle/>Reopen profile</button>}{hasPermission("employees.lifecycle.manage")&&<button className="archive-action" onClick={()=>window.confirm(`Archive ${employee.fullName}? Their workspace membership will be disabled.`)&&archiveMutation.mutate()}><Archive/>Archive</button>}</div></>}</header>
    {detail.isLoading&&<p className="profile-loading">Loading employee profile…</p>}{detail.isError&&<p className="profile-loading">The private profile could not be loaded.</p>}
    {employee&&<><nav><button className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Overview</button><button className={tab==="personal"?"active":""} onClick={()=>setTab("personal")}>Personal</button><button className={tab==="history"?"active":""} onClick={()=>setTab("history")}>History</button></nav><div className="profile-body">
      {tab==="overview"&&<><section><h3>Employment</h3><dl><div><dt>Department</dt><dd>{employee.departmentName||"Unassigned"}</dd></div><div><dt>Job title</dt><dd>{employee.jobTitleName||"Unassigned"}</dd></div><div><dt>Manager</dt><dd>{employee.managerName||"No manager"}</dd></div><div><dt>Location</dt><dd>{employee.workLocationName||"Unassigned"}</dd></div><div><dt>Type</dt><dd>{humanize(employee.employmentType)}</dd></div><div><dt>Work mode</dt><dd>{humanize(employee.workMode)}</dd></div><div><dt>Join date</dt><dd>{new Date(employee.joinDate).toLocaleDateString()}</dd></div><div><dt>Cost center</dt><dd>{employee.costCenter||"Not set"}</dd></div></dl></section><section><h3>Work contact</h3><p><EnvelopeSimple/>{employee.workEmail||"No work email"}</p><p><Phone/>{employee.workPhone||"No work phone"}</p></section></>}
      {tab==="personal"&&<><section><h3>Private details</h3><dl><div><dt>Date of birth</dt><dd>{employee.dateOfBirth?new Date(employee.dateOfBirth).toLocaleDateString():"Not set"}</dd></div><div><dt>Gender</dt><dd>{humanize(employee.gender)}</dd></div><div><dt>Pronouns</dt><dd>{employee.pronouns||"Not set"}</dd></div><div><dt>Nationality</dt><dd>{employee.nationality||"Not set"}</dd></div><div><dt>Blood group</dt><dd>{employee.bloodGroup||"Not set"}</dd></div><div><dt>Personal email</dt><dd>{employee.personalEmail||"Not set"}</dd></div></dl></section><section><h3>Addresses</h3>{employee.addresses.length?employee.addresses.map(address=><p key={address.id}><MapPin/>{address.line1}, {address.city}, {address.country}</p>):<p>No addresses recorded.</p>}</section><section><h3>Emergency contacts</h3>{employee.emergencyContacts.length?employee.emergencyContacts.map(contact=><p key={contact.id}><Phone/>{contact.name} · {contact.relationship} · {contact.phone}</p>):<p>No emergency contacts recorded.</p>}</section><ProtectedRecords employee={employee}/></>}
      {tab==="history"&&<div className="employee-timeline">{history.isLoading&&<p>Loading history…</p>}{history.data?.statuses.map(item=><article key={item.id}><i><CheckCircle/></i><div><strong>{humanize(item.toStatus)}</strong><small>{new Date(item.effectiveDate).toLocaleDateString()} · {item.reason||"No reason recorded"}</small></div></article>)}{history.data?.jobs.map(item=><article key={item.id}><i><Briefcase/></i><div><strong>{item.jobTitleName||"Employment assignment"}</strong><small>{item.departmentName||"Unassigned"} · from {new Date(item.effectiveFrom).toLocaleDateString()}</small></div></article>)}</div>}
    </div></>}
    {employee&&statusOpen&&<StatusEditor employee={employee} onClose={()=>setStatusOpen(false)}/>} 
  </aside></div>;
}

export function EmployeesPage({onTheme,onMenu}:{onTheme:()=>void;onMenu:()=>void}){
  const {hasPermission}=useAuth();
  const queryClient=useQueryClient();
  const [search,setSearch]=useState("");const [status,setStatus]=useState("all");const [employmentType,setEmploymentType]=useState("all");const [departmentId,setDepartmentId]=useState("");const [page,setPage]=useState(1);const [newOpen,setNewOpen]=useState(false);const [selected,setSelected]=useState<string|null>(null);const [editing,setEditing]=useState<EmployeeDetail|undefined>();
  const [view,setView]=useState<"directory"|"tree"|"events"|"archived">("directory");const [bulkMode,setBulkMode]=useState(false);const [selectedIds,setSelectedIds]=useState<string[]>([]);const [bulkOpen,setBulkOpen]=useState(false);
  const filters={page,pageSize:20,search,status,employmentType,departmentId:departmentId||undefined};
  const directory=useQuery({queryKey:["employees",filters],queryFn:()=>employeeApi.list(filters)});const summary=useQuery({queryKey:["employee-summary"],queryFn:employeeApi.summary});const metadata=useQuery({queryKey:["employee-metadata"],queryFn:employeeApi.metadata});const nextNumber=useQuery({queryKey:["employee-next-number"],queryFn:employeeApi.nextNumber});
  const tree=useQuery({queryKey:["employee-tree"],queryFn:employeeApi.organizationTree,enabled:view==="tree"});const events=useQuery({queryKey:["employee-events"],queryFn:()=>employeeApi.upcomingEvents(90),enabled:view==="events"});const archived=useQuery({queryKey:["archived-employees"],queryFn:()=>employeeApi.archived({page:1,pageSize:100}),enabled:view==="archived"});
  const cards=[["Total employees",summary.data?.total||0,UsersThree],["Active",summary.data?.active||0,CheckCircle],["Probation",summary.data?.probation||0,CalendarCheck],["On leave",summary.data?.onLeave||0,UserCircle]] as const;
  const toggleEmployee=(id:string)=>setSelectedIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
  const leaveBulkMode=()=>{setBulkMode(false);setSelectedIds([]);};
  return <main className="main-content"><header className="topbar"><button className="mobile-menu icon-button" onClick={onMenu}><List/></button><div className="topbar-copy"><span>Employee directory</span><strong>People records</strong></div><div className="topbar-actions"><button className="theme-trigger" onClick={onTheme}><Palette/>Theme</button><div className="avatar">MK</div></div></header><div className="employees-wrap">
    <section className="page-heading"><div><span className="eyebrow dark"><IdentificationCard/>EMPLOYEE DIRECTORY</span><h1>Everyone, in one place</h1><p>Employment profiles, reporting lines and lifecycle details built on one source of truth.</p></div><div className="heading-actions">{hasPermission("employees.export")&&<button className="secondary-button" onClick={()=>employeeApi.exportCsv(filters)}><DownloadSimple/>Export</button>}{hasPermission("employees.manage")&&<button className="primary-button" onClick={()=>setNewOpen(true)}><Plus/>New employee</button>}</div></section>
    <section className="employee-summary">{cards.map(([label,value,Icon])=><article key={label}><span><Icon/></span><div><small>{label}</small><strong>{value}</strong></div></article>)}</section>
    <nav className="employee-view-tabs"><button className={view==="directory"?"active":""} onClick={()=>setView("directory")}><IdentificationCard/>Directory</button><button className={view==="tree"?"active":""} onClick={()=>setView("tree")}><TreeStructure/>Org tree</button><button className={view==="events"?"active":""} onClick={()=>setView("events")}><Cake/>Upcoming</button><button className={view==="archived"?"active":""} onClick={()=>setView("archived")}><Archive/>Archived</button>{view==="directory"&&hasPermission("employees.bulk.manage")&&<span>{bulkMode?<><button disabled={!selectedIds.length} onClick={()=>setBulkOpen(true)}>Update {selectedIds.length||"selected"}</button><button onClick={leaveBulkMode}>Cancel</button></>:<button onClick={()=>setBulkMode(true)}>Bulk assign</button>}</span>}</nav>
    {view==="directory"&&<section className="employee-directory-card"><header className="employee-filters"><label className="search-box"><MagnifyingGlass/><input aria-label="Search employees" placeholder="Search name, ID or work email" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}}/></label><select aria-label="Employment status" value={status} onChange={event=>{setStatus(event.target.value);setPage(1);}}><option value="all">All statuses</option>{["preboarding","probation","active","on_leave","notice_period","suspended","terminated"].map(value=><option value={value} key={value}>{humanize(value)}</option>)}</select><select aria-label="Employment type" value={employmentType} onChange={event=>{setEmploymentType(event.target.value);setPage(1);}}><option value="all">All types</option>{["full_time","part_time","contract","intern","temporary","apprentice"].map(value=><option value={value} key={value}>{humanize(value)}</option>)}</select><select aria-label="Department" value={departmentId} onChange={event=>{setDepartmentId(event.target.value);setPage(1);}}><option value="">All departments</option>{metadata.data?.departments.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></header>
      <div className="employee-table-head"><span>Employee</span><span>Role & department</span><span>Location</span><span>Manager</span><span>Status</span></div>
      {directory.isLoading&&<p className="directory-message">Loading employee directory…</p>}{directory.isError&&<p className="directory-message error">The employee directory could not be loaded.</p>}{directory.data?.items.length===0&&<p className="directory-message">No employees match these filters.</p>}
      {directory.data?.items.map((employee:DirectoryEmployee)=><button className={`employee-row ${selectedIds.includes(employee.id)?"bulk-selected":""}`} aria-pressed={bulkMode?selectedIds.includes(employee.id):undefined} key={employee.id} onClick={()=>bulkMode?toggleEmployee(employee.id):setSelected(employee.id)}><span className="employee-cell"><i>{employee.profilePhotoUrl?<img src={employee.profilePhotoUrl} alt=""/>:<>{employee.firstName[0]}{employee.lastName[0]}</>}</i><p><strong>{employee.fullName}</strong><small>{employee.employeeNumber} · {employee.workEmail||"No work email"}</small></p></span><span><strong>{employee.jobTitleName||"Unassigned"}</strong><small>{employee.departmentName||"No department"}</small></span><span><MapPin/>{employee.workLocationName||humanize(employee.workMode)}</span><span>{employee.managerName||"No manager"}</span><i className={`employee-status ${employee.employmentStatus}`}>{humanize(employee.employmentStatus)}</i></button>)}
      {(directory.data?.totalPages||0)>1&&<footer className="directory-pagination"><span>Page {directory.data?.page} of {directory.data?.totalPages}</span><div><button disabled={page===1} onClick={()=>setPage(value=>value-1)}><CaretLeft/>Previous</button><button disabled={page===(directory.data?.totalPages||1)} onClick={()=>setPage(value=>value+1)}>Next<CaretRight/></button></div></footer>}
    </section>}
    {view==="tree"&&<EmployeeTree items={(tree.data||[]) as TreeEmployee[]} onOpen={setSelected}/>} {view==="events"&&<EmployeeEvents items={events.data||[]} onOpen={setSelected}/>} 
    {view==="archived"&&<section className="employee-insight-card"><header><Archive/><div><h2>Archived employees</h2><p>Reversible records removed from active HR workflows.</p></div></header><div className="archived-list">{archived.data?.items.map(employee=><article key={employee.id}><div><strong>{employee.fullName}</strong><small>{employee.employeeNumber} · {employee.workEmail||"No work email"}</small></div><button className="secondary-button" onClick={()=>employeeApi.restore(employee.id,{version:employee.version,reason:"Restored by an administrator"}).then(()=>{queryClient.invalidateQueries({queryKey:["archived-employees"]});queryClient.invalidateQueries({queryKey:["employees"]});queryClient.invalidateQueries({queryKey:["employee-summary"]});})}>Restore</button></article>)}{!archived.isLoading&&!archived.data?.items.length&&<p className="directory-message">No employee records are archived.</p>}</div></section>}
  </div>{metadata.data&&(newOpen||editing)&&<EmployeeEditor metadata={metadata.data} employee={editing} suggestedNumber={nextNumber.data?.employeeNumber} onClose={()=>{setNewOpen(false);setEditing(undefined);}}/>}{selected&&<EmployeeProfile employeeId={selected} onClose={()=>setSelected(null)} onEdit={employee=>{setEditing(employee);setSelected(null);}}/>}{bulkOpen&&metadata.data&&<BulkEmployeeEditor employeeIds={selectedIds} metadata={metadata.data} onClose={()=>{setBulkOpen(false);leaveBulkMode();}}/>}</main>;
}
