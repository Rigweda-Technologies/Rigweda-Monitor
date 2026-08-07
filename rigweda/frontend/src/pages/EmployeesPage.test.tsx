import {fireEvent,render,screen} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {EmployeesPage} from "./EmployeesPage";

const employeeMocks=vi.hoisted(()=>({
  list:vi.fn(),summary:vi.fn(),metadata:vi.fn(),nextNumber:vi.fn(),upcomingEvents:vi.fn(),organizationTree:vi.fn(),archived:vi.fn(),
  get:vi.fn(),history:vi.fn(),create:vi.fn(),update:vi.fn(),changeStatus:vi.fn(),bulkUpdate:vi.fn(),archive:vi.fn(),restore:vi.fn(),
  reopenProfile:vi.fn(),updateSensitiveRecords:vi.fn(),addIdentifier:vi.fn(),removeIdentifier:vi.fn(),addDocument:vi.fn(),removeDocument:vi.fn(),exportCsv:vi.fn()
}));
vi.mock("../features/employees/employee.api",()=>({employeeApi:employeeMocks}));

const directoryEmployee={
  id:"employee-1",employeeNumber:"RW-0001",firstName:"Rigweda",lastName:"Administrator",preferredName:"Admin",
  fullName:"Rigweda Administrator",workEmail:"admin@rigweda.com",workPhone:null,profilePhotoUrl:null,employmentStatus:"active",
  employmentType:"full_time",workMode:"hybrid",joinDate:"2026-08-07",departmentId:"department-1",departmentName:"General",
  jobTitleId:"title-1",jobTitleName:"Team Member",workLocationId:"location-1",workLocationName:"Main Office",
  managerEmployeeId:null,managerName:null,profileCompleted:false,archivedAt:null,version:1
};
const detail={...directoryEmployee,userId:"user-1",middleName:null,personalEmail:null,personalPhone:null,dateOfBirth:null,gender:null,
  pronouns:null,maritalStatus:null,bloodGroup:null,nationality:"IN",biography:null,probationEndDate:null,confirmationDate:null,
  noticeStartDate:null,lastWorkingDate:null,terminationDate:null,terminationReason:null,costCenter:null,timezone:"Asia/Kolkata",
  metadata:{},addresses:[],emergencyContacts:[],probationPeriodDays:90,noticePeriodDays:30,benefitsEligible:true,noticeEndDate:null,
  profileCompleted:false,archivedAt:null,identifiers:[],documents:[]};

const renderPage=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EmployeesPage onMenu={()=>{}} onTheme={()=>{}}/></QueryClientProvider>);

describe("Employee directory",()=>{
  beforeEach(()=>{
    employeeMocks.list.mockResolvedValue({items:[directoryEmployee],total:1,page:1,pageSize:20,totalPages:1});
    employeeMocks.summary.mockResolvedValue({total:1,active:1,probation:0,onLeave:0,noticePeriod:0,preboarding:0});
    employeeMocks.metadata.mockResolvedValue({departments:[{id:"department-1",code:"GENERAL",name:"General"}],jobTitles:[{id:"title-1",code:"TEAM_MEMBER",name:"Team Member",jobLevel:null}],workLocations:[{id:"location-1",code:"MAIN",name:"Main Office",locationType:"office",timezone:"Asia/Kolkata"}],managers:[],availableUsers:[]});
    employeeMocks.nextNumber.mockResolvedValue({employeeNumber:"RW-0002"});
    employeeMocks.organizationTree.mockResolvedValue([{...directoryEmployee,reports:[]}]);
    employeeMocks.upcomingEvents.mockResolvedValue([{type:"work_anniversary",date:"2026-08-20",employeeId:"employee-1",employeeNumber:"RW-0001",name:"Rigweda Administrator"}]);
    employeeMocks.archived.mockResolvedValue({items:[],total:0,page:1,pageSize:100,totalPages:0});
    employeeMocks.get.mockResolvedValue(detail);
    employeeMocks.history.mockResolvedValue({statuses:[],jobs:[],changes:[]});
  });

  it("loads directory totals and opens the private profile",async()=>{
    renderPage();
    expect(await screen.findByText("Rigweda Administrator")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:/Rigweda Administrator/}));
    expect(await screen.findByRole("heading",{name:"Rigweda Administrator"})).toBeInTheDocument();
    expect(screen.getAllByText("Main Office").length).toBeGreaterThan(0);
  });

  it("opens all employee creation sections",async()=>{
    renderPage();
    await screen.findByText("Rigweda Administrator");
    fireEvent.click(screen.getByRole("button",{name:/new employee/i}));
    expect(screen.getByRole("heading",{name:"Add an employee"})).toBeInTheDocument();
    expect(screen.getByLabelText("Employee number")).toBeRequired();
    fireEvent.click(screen.getByRole("button",{name:/Employment/}));
    expect(screen.getByLabelText("Join date")).toBeRequired();
    fireEvent.click(screen.getByRole("button",{name:/Contact & emergency/}));
    expect(screen.getByLabelText("Emergency phone")).toBeInTheDocument();
  });

  it("provides organization tree, events and archive workspaces",async()=>{
    renderPage();await screen.findByText("Rigweda Administrator");
    fireEvent.click(screen.getByRole("button",{name:/Org tree/}));expect(await screen.findByRole("heading",{name:"Organization tree"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:/Upcoming/}));expect(await screen.findByText(/Work Anniversary/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:/Archived/}));expect(await screen.findByText("No employee records are archived.")).toBeInTheDocument();
  });
});
