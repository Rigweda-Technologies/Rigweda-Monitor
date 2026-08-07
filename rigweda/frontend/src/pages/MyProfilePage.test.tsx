import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {MyProfilePage} from "./MyProfilePage";

const employeeMocks=vi.hoisted(()=>({myProfile:vi.fn(),completeMyProfile:vi.fn()}));
vi.mock("../features/employees/employee.api",()=>({employeeApi:employeeMocks}));

const profile={
  id:"employee-1",employeeNumber:"RW-0001",userId:"user-1",firstName:"Rigweda",middleName:null,lastName:"Administrator",
  preferredName:"Admin",fullName:"Rigweda Administrator",workEmail:"admin@rigweda.com",personalEmail:"admin@example.com",
  workPhone:null,personalPhone:"9876543210",dateOfBirth:"1990-01-15",gender:"prefer_not_to_say",pronouns:null,
  maritalStatus:null,bloodGroup:"O+",nationality:"IN",profilePhotoUrl:null,biography:null,employmentStatus:"active" as const,
  employmentType:"full_time" as const,workMode:"hybrid" as const,joinDate:"2026-08-07",probationEndDate:null,
  confirmationDate:null,noticeStartDate:null,noticeEndDate:null,lastWorkingDate:null,terminationDate:null,terminationReason:null,
  departmentId:"department-1",departmentName:"General",jobTitleId:"title-1",jobTitleName:"Team Member",workLocationId:"location-1",
  workLocationName:"Main Office",managerEmployeeId:null,managerName:null,costCenter:null,timezone:"Asia/Kolkata",metadata:{},
  addresses:[{id:"address-1",addressType:"current" as const,line1:"Main Road",line2:null,city:"Hyderabad",state:"Telangana",postalCode:"500001",country:"IN",isPrimary:true}],
  emergencyContacts:[{id:"contact-1",name:"Emergency Contact",relationship:"Family",phone:"9999999999",alternatePhone:null,email:null,isPrimary:true}],
  probationPeriodDays:90,noticePeriodDays:30,benefitsEligible:true,profileCompleted:false,archivedAt:null,identifiers:[],documents:[],version:1
};

const renderPage=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MyProfilePage onMenu={()=>{}} onTheme={()=>{}}/></QueryClientProvider>);

describe("My employee profile",()=>{
  beforeEach(()=>{
    employeeMocks.myProfile.mockResolvedValue(profile);
    employeeMocks.completeMyProfile.mockResolvedValue({...profile,profileCompleted:true,version:2});
  });

  it("loads the linked employee and saves self-service information",async()=>{
    renderPage();
    expect(await screen.findByRole("heading",{name:"Your employee profile"})).toBeInTheDocument();
    expect(screen.getByText("RW-0001")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Personal phone"),{target:{value:"9123456789"}});
    fireEvent.click(screen.getByRole("button",{name:"Complete and save profile"}));
    await waitFor(()=>expect(employeeMocks.completeMyProfile).toHaveBeenCalledWith(expect.objectContaining({personalPhone:"9123456789",version:1})));
    expect(await screen.findByText("Profile completed and saved.")).toBeInTheDocument();
  });
});
