import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { Eye, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  deleteApiWithToken,
  getApiWithToken,
  postApiWithToken,
  putApiWithToken
} from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { formatDateTimeInOrgTimeZone } from "@/utils/timezone";

type JobStatus = "draft" | "open" | "on_hold" | "closed";
type CandidateStage = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";

type HiringJob = {
  _id: string;
  title: string;
  department?: string;
  employmentType?: string;
  location?: string;
  openings?: number;
  status: JobStatus;
};

type HiringCandidate = {
  _id: string;
  jobId?: { _id: string; title: string } | string;
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  yearsExperience?: number;
  keySkills?: string[];
  highestQualification?: string;
  currentLocation?: string;
  preferredLocation?: string;
  noticePeriodDays?: number;
  expectedCTC?: number;
  linkedInUrl?: string;
  resumeUrl?: string;
  futureConsideration?: boolean;
  offerLetterReleasedAt?: string | null;
  rejectionEmailSentAt?: string | null;
  convertedToEmployeeId?: string | null;
  convertedAt?: string | null;
  interviews?: {
    _id?: string;
    roundName?: string;
    interviewerEmployeeId?: { _id: string; firstName?: string; lastName?: string; employeeCode?: string } | null;
    scheduledAt?: string;
    mode?: "virtual" | "onsite" | "phone";
    meetingLink?: string;
    status?: "scheduled" | "completed" | "cancelled";
    feedback?: string;
    scorecard?: {
      communication?: number | null;
      technical?: number | null;
      problemSolving?: number | null;
      cultureFit?: number | null;
      overall?: number | null;
    };
    recommendation?: "strong_hire" | "hire" | "hold" | "reject" | null;
  }[];
  stage: CandidateStage;
  status: string;
  assignedTo?: { _id: string; firstName?: string; lastName?: string; employeeCode?: string } | null;
};

type EmployeeOption = {
  _id: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
};

type MasterOption = {
  _id: string;
  name?: string;
  slug?: string;
  startTime?: string;
  endTime?: string;
};

const stageOrder: CandidateStage[] = ["applied", "screening", "interview", "offer", "hired", "rejected"];

const emptyJob = {
  title: "",
  department: "",
  employmentType: "full_time",
  location: "",
  openings: 1,
  description: "",
  status: "open" as JobStatus
};

const emptyCandidate = {
  jobId: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  yearsExperience: 0,
  currentLocation: "",
  preferredLocation: "",
  highestQualification: "",
  specialization: "",
  collegeName: "",
  graduationYear: "",
  keySkillsText: "",
  currentCompany: "",
  currentCTC: 0,
  expectedCTC: 0,
  noticePeriodDays: 0,
  linkedInUrl: "",
  portfolioUrl: "",
  resumeUrl: "",
  interviewNotes: "",
  remarks: "",
  futureConsideration: true,
  nextFollowUpAt: "",
  stage: "applied" as CandidateStage,
  source: "direct",
  assignedTo: ""
};

const Hiring = () => {
  const { hasAnyPermission } = useAuth();
  const canView = hasAnyPermission(["HIRING_VIEW", "HIRING_MANAGE"]);
  const canManage = hasAnyPermission(["HIRING_MANAGE"]);

  const [overview, setOverview] = useState<any>(null);
  const [jobs, setJobs] = useState<HiringJob[]>([]);
  const [candidates, setCandidates] = useState<HiringCandidate[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [roles, setRoles] = useState<MasterOption[]>([]);
  const [departments, setDepartments] = useState<MasterOption[]>([]);
  const [designations, setDesignations] = useState<MasterOption[]>([]);
  const [shifts, setShifts] = useState<MasterOption[]>([]);
  const [loading, setLoading] = useState(false);

  const [jobOpen, setJobOpen] = useState(false);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [activeCandidateId, setActiveCandidateId] = useState<string>("");
  const [activeInterviewId, setActiveInterviewId] = useState<string>("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [searchText, setSearchText] = useState("");
  const [filterJobId, setFilterJobId] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [jobForm, setJobForm] = useState({ ...emptyJob });
  const [candidateForm, setCandidateForm] = useState({ ...emptyCandidate });
  const [scheduleForm, setScheduleForm] = useState({
    roundName: "L1",
    interviewerEmployeeId: "",
    scheduledAt: "",
    mode: "virtual" as "virtual" | "onsite" | "phone",
    meetingLink: ""
  });
  const [feedbackForm, setFeedbackForm] = useState({
    feedback: "",
    communication: 3,
    technical: 3,
    problemSolving: 3,
    cultureFit: 3,
    overall: 3,
    recommendation: "hold" as "strong_hire" | "hire" | "hold" | "reject",
    status: "completed" as "scheduled" | "completed" | "cancelled"
  });
  const [convertForm, setConvertForm] = useState({
    roleIds: [] as string[],
    departmentId: "",
    designationId: "",
    managerId: "",
    shiftId: "",
    employmentType: "full_time",
    dateOfJoining: new Date().toISOString().slice(0, 10),
    password: ""
  });

  const loadAll = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const [overviewRes, jobsRes, candidatesRes, employeesRes, rolesRes, departmentsRes, designationsRes, shiftsRes] = await Promise.all([
        getApiWithToken("/hiring/overview", null, { requiredPermissions: ["HIRING_VIEW", "HIRING_MANAGE"] }),
        getApiWithToken("/hiring/jobs", null, { requiredPermissions: ["HIRING_VIEW", "HIRING_MANAGE"] }),
        getApiWithToken("/hiring/candidates", null, { requiredPermissions: ["HIRING_VIEW", "HIRING_MANAGE"] }),
        getApiWithToken("/hiring/employees", null, { requiredPermissions: ["HIRING_VIEW", "HIRING_MANAGE"] }),
        getApiWithToken("/roles"),
        getApiWithToken("/departments"),
        getApiWithToken("/designations"),
        getApiWithToken("/shifts")
      ]);
      if (overviewRes?.success) setOverview(overviewRes.data);
      if (jobsRes?.success) setJobs(jobsRes.data || []);
      if (candidatesRes?.success) setCandidates(candidatesRes.data || []);
      if (employeesRes?.success) setEmployees(employeesRes.data || []);
      if (rolesRes?.success) setRoles(rolesRes.data || []);
      if (departmentsRes?.success) setDepartments(departmentsRes.data || []);
      if (designationsRes?.success) setDesignations(designationsRes.data || []);
      if (shiftsRes?.success) setShifts(shiftsRes.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filteredCandidates = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    return (candidates || []).filter((c) => {
      if (filterJobId !== "all") {
        const jobId = typeof c.jobId === "object" ? c.jobId?._id : c.jobId;
        if (jobId !== filterJobId) return false;
      }
      if (filterStage !== "all" && c.stage !== filterStage) return false;
      if (filterStatus !== "all" && (c.status || "active") !== filterStatus) return false;
      if (!query) return true;
      const fullName = `${c.firstName || ""} ${c.lastName || ""}`.trim().toLowerCase();
      const email = String(c.email || "").toLowerCase();
      const phone = String(c.phone || "").toLowerCase();
      const skills = (c.keySkills || []).join(" ").toLowerCase();
      return (
        fullName.includes(query) ||
        email.includes(query) ||
        phone.includes(query) ||
        skills.includes(query)
      );
    });
  }, [candidates, searchText, filterJobId, filterStage, filterStatus]);

  const selectedCandidate = useMemo(
    () => (candidates || []).find((row) => row._id === selectedCandidateId) || null,
    [candidates, selectedCandidateId]
  );
  const activeCandidate = useMemo(
    () => (candidates || []).find((row) => row._id === activeCandidateId) || null,
    [candidates, activeCandidateId]
  );

  const stageBuckets = useMemo(() => {
    const map: Record<CandidateStage, HiringCandidate[]> = {
      applied: [],
      screening: [],
      interview: [],
      offer: [],
      hired: [],
      rejected: []
    };
    for (const row of filteredCandidates) {
      if (map[row.stage]) map[row.stage].push(row);
    }
    return map;
  }, [filteredCandidates]);

  const openCandidateDetails = (candidateId: string) => {
    setSelectedCandidateId(candidateId);
    setDetailsOpen(true);
  };

  const createJob = async () => {
    if (!jobForm.title.trim()) {
      toast.error("Job title is required");
      return;
    }
    const res = await postApiWithToken("/hiring/jobs", jobForm, null, { requiredPermissions: ["HIRING_MANAGE"] });
    if (!res?.success) {
      toast.error(res?.message || "Failed to create job");
      return;
    }
    toast.success("Job created");
    setJobOpen(false);
    setJobForm({ ...emptyJob });
    loadAll();
  };

  const createCandidate = async () => {
    if (!candidateForm.jobId || !candidateForm.firstName || !candidateForm.email) {
      toast.error("Job, first name and email are required");
      return;
    }
    const payload = {
      jobId: candidateForm.jobId,
      firstName: candidateForm.firstName,
      lastName: candidateForm.lastName,
      email: candidateForm.email,
      phone: candidateForm.phone,
      source: candidateForm.source,
      resumeUrl: candidateForm.resumeUrl,
      yearsExperience: Number(candidateForm.yearsExperience || 0),
      currentLocation: candidateForm.currentLocation,
      preferredLocation: candidateForm.preferredLocation,
      highestQualification: candidateForm.highestQualification,
      specialization: candidateForm.specialization,
      collegeName: candidateForm.collegeName,
      graduationYear: candidateForm.graduationYear ? Number(candidateForm.graduationYear) : null,
      keySkills: String(candidateForm.keySkillsText || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      linkedInUrl: candidateForm.linkedInUrl,
      portfolioUrl: candidateForm.portfolioUrl,
      currentCompany: candidateForm.currentCompany,
      currentCTC: Number(candidateForm.currentCTC || 0),
      expectedCTC: Number(candidateForm.expectedCTC || 0),
      noticePeriodDays: Number(candidateForm.noticePeriodDays || 0),
      futureConsideration: candidateForm.futureConsideration,
      nextFollowUpAt: candidateForm.nextFollowUpAt || null,
      stage: candidateForm.stage,
      assignedTo: candidateForm.assignedTo || null,
      remarks: candidateForm.remarks,
      interviewNotes: candidateForm.interviewNotes
    };
    const res = await postApiWithToken("/hiring/candidates", payload, null, {
      requiredPermissions: ["HIRING_MANAGE"]
    });
    if (!res?.success) {
      toast.error(res?.message || "Failed to create candidate");
      return;
    }
    toast.success("Candidate created");
    setCandidateOpen(false);
    setCandidateForm({ ...emptyCandidate });
    loadAll();
  };

  const moveStage = async (candidateId: string, stage: CandidateStage) => {
    const res = await putApiWithToken(
      `/hiring/candidates/${candidateId}/stage`,
      { stage },
      null,
      { requiredPermissions: ["HIRING_MANAGE"] }
    );
    if (!res?.success) {
      toast.error(res?.message || "Failed to update stage");
      return;
    }
    loadAll();
  };

  const closeJob = async (jobId: string) => {
    const res = await putApiWithToken(`/hiring/jobs/${jobId}`, { status: "closed" }, null, {
      requiredPermissions: ["HIRING_MANAGE"]
    });
    if (!res?.success) {
      toast.error(res?.message || "Failed to close job");
      return;
    }
    toast.success("Job closed");
    loadAll();
  };

  const deleteCandidate = async (candidateId: string) => {
    const res = await deleteApiWithToken(`/hiring/candidates/${candidateId}`);
    if (!res?.success) {
      toast.error(res?.message || "Failed to delete candidate");
      return;
    }
    toast.success("Candidate deleted");
    loadAll();
  };

  const moveToTalentPool = async (candidateId: string) => {
    const res = await putApiWithToken(
      `/hiring/candidates/${candidateId}/stage`,
      { stage: "rejected", note: "Moved to talent pool for future opportunities" },
      null,
      { requiredPermissions: ["HIRING_MANAGE"] }
    );
    if (!res?.success) {
      toast.error(res?.message || "Failed to move candidate");
      return;
    }
    toast.success("Candidate moved to talent pool");
    loadAll();
  };

  const releaseOfferLetter = async (candidateId: string) => {
    const res = await postApiWithToken(
      `/hiring/candidates/${candidateId}/release-offer-letter`,
      {},
      null,
      { requiredPermissions: ["HIRING_MANAGE"] }
    );
    if (!res?.success) {
      toast.error(res?.message || "Failed to release offer letter");
      return;
    }
    toast.success("Offer letter released to candidate email");
    loadAll();
  };

  const sendRejectionEmail = async (candidateId: string) => {
    const res = await postApiWithToken(
      `/hiring/candidates/${candidateId}/send-rejection-email`,
      {},
      null,
      { requiredPermissions: ["HIRING_MANAGE"] }
    );
    if (!res?.success) {
      toast.error(res?.message || "Failed to send rejection email");
      return;
    }
    toast.success("Rejection email sent to candidate");
    loadAll();
  };

  const openConvertDialog = (candidate: HiringCandidate) => {
    const candidateJobId = typeof candidate.jobId === "object" ? candidate.jobId?._id : candidate.jobId;
    const matchedJob = (jobs || []).find((job) => job._id === candidateJobId);
    const matchedDepartment = (departments || []).find(
      (dept) =>
        String(dept.name || "").trim().toLowerCase() ===
        String(matchedJob?.department || "").trim().toLowerCase()
    );
    const defaultEmployeeRole = (roles || []).find(
      (role) =>
        String(role.slug || "").toLowerCase() === "employee" ||
        String(role.name || "").trim().toLowerCase() === "employee"
    );
    setActiveCandidateId(candidate._id);
    setConvertForm({
      roleIds: defaultEmployeeRole?._id ? [defaultEmployeeRole._id] : [],
      departmentId: matchedDepartment?._id || "",
      designationId: "",
      managerId: "",
      shiftId: "",
      employmentType: (matchedJob?.employmentType as "full_time" | "part_time" | "contract") || "full_time",
      dateOfJoining: new Date().toISOString().slice(0, 10),
      password: ""
    });
    setConvertOpen(true);
  };

  const toggleConvertRole = (roleId: string) => {
    setConvertForm((prev) => {
      const hasRole = prev.roleIds.includes(roleId);
      return {
        ...prev,
        roleIds: hasRole ? prev.roleIds.filter((id) => id !== roleId) : [...prev.roleIds, roleId]
      };
    });
  };

  const convertCandidateToEmployee = async () => {
    if (!activeCandidateId) return;
    if (
      !convertForm.password ||
      convertForm.roleIds.length === 0 ||
      !convertForm.departmentId ||
      !convertForm.designationId ||
      !convertForm.employmentType ||
      !convertForm.dateOfJoining
    ) {
      toast.error("Role, department, designation, employment type, joining date and password are required");
      return;
    }
    const payload = {
      password: convertForm.password,
      roleIds: convertForm.roleIds,
      departmentId: convertForm.departmentId,
      designationId: convertForm.designationId,
      managerId: convertForm.managerId || null,
      shiftId: convertForm.shiftId || null,
      employmentType: convertForm.employmentType,
      dateOfJoining: convertForm.dateOfJoining
    };
    const res = await postApiWithToken(
      `/hiring/candidates/${activeCandidateId}/convert-to-employee`,
      payload,
      null,
      { requiredPermissions: ["HIRING_MANAGE"] }
    );
    if (!res?.success) {
      toast.error(res?.message || "Failed to convert candidate");
      return;
    }
    toast.success("Candidate converted to employee");
    setConvertOpen(false);
    loadAll();
  };

  const openScheduleDialog = (candidateId: string) => {
    setActiveCandidateId(candidateId);
    setScheduleForm({
      roundName: "L1",
      interviewerEmployeeId: "",
      scheduledAt: "",
      mode: "virtual",
      meetingLink: ""
    });
    setScheduleOpen(true);
  };

  const scheduleInterview = async () => {
    if (!activeCandidateId || !scheduleForm.scheduledAt) {
      toast.error("Please select interview date/time");
      return;
    }
    const res = await postApiWithToken(
      `/hiring/candidates/${activeCandidateId}/interviews`,
      {
        roundName: scheduleForm.roundName,
        interviewerEmployeeId: scheduleForm.interviewerEmployeeId || null,
        scheduledAt: scheduleForm.scheduledAt,
        mode: scheduleForm.mode,
        meetingLink: scheduleForm.meetingLink || ""
      },
      null,
      { requiredPermissions: ["HIRING_MANAGE"] }
    );
    if (!res?.success) {
      toast.error(res?.message || "Failed to schedule interview");
      return;
    }
    toast.success("Interview scheduled");
    setScheduleOpen(false);
    loadAll();
  };

  const openFeedbackDialog = (candidateId: string, interviewId: string) => {
    const candidate = candidates.find((c) => c._id === candidateId);
    const interview = (candidate?.interviews || []).find((i) => i._id === interviewId);
    setActiveCandidateId(candidateId);
    setActiveInterviewId(interviewId);
    setFeedbackForm({
      feedback: interview?.feedback || "",
      communication: Number(interview?.scorecard?.communication || 3),
      technical: Number(interview?.scorecard?.technical || 3),
      problemSolving: Number(interview?.scorecard?.problemSolving || 3),
      cultureFit: Number(interview?.scorecard?.cultureFit || 3),
      overall: Number(interview?.scorecard?.overall || 3),
      recommendation: (interview?.recommendation as any) || "hold",
      status: (interview?.status as any) || "completed"
    });
    setFeedbackOpen(true);
  };

  const submitInterviewFeedback = async () => {
    if (!activeCandidateId || !activeInterviewId) return;
    const res = await putApiWithToken(
      `/hiring/candidates/${activeCandidateId}/interviews/${activeInterviewId}/feedback`,
      feedbackForm,
      null,
      { requiredPermissions: ["HIRING_MANAGE"] }
    );
    if (!res?.success) {
      toast.error(res?.message || "Failed to submit feedback");
      return;
    }
    toast.success("Interview feedback submitted");
    setFeedbackOpen(false);
    loadAll();
  };

  return (
    <MainLayout title="Hiring Workflow" breadcrumb={[{ label: "Home", href: "/" }, { label: "Hiring" }]}>
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view hiring workflow.
        </div>
      )}

      {canView && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="stat-card">
              <p className="text-sm text-muted-foreground">Open Jobs</p>
              <p className="text-2xl font-bold">{overview?.openJobs || 0}</p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-muted-foreground">Total Candidates</p>
              <p className="text-2xl font-bold">{overview?.totalCandidates || 0}</p>
            </div>
            <div className="stat-card">
              <p className="text-sm text-muted-foreground">Hired</p>
              <p className="text-2xl font-bold">{overview?.stageBreakdown?.hired || 0}</p>
            </div>
          </div>

          {canManage && (
            <div className="flex flex-wrap gap-2 mb-4">
              <Button onClick={() => setJobOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Job
              </Button>
              <Button variant="outline" onClick={() => setCandidateOpen(true)}>
                <UserPlus className="w-4 h-4 mr-2" />
                Add Candidate
              </Button>
            </div>
          )}

          <div className="bg-card rounded-xl card-shadow p-4 mb-5">
            <p className="font-semibold mb-3">Job Openings</p>
            {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
            {!loading && jobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet.</p>}
            {!loading && jobs.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {jobs.map((job) => (
                  <div key={job._id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{job.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {job.department || "-"} • {job.location || "-"} • {job.openings || 1} opening(s)
                        </p>
                      </div>
                      <Badge variant={job.status === "open" ? "default" : "secondary"} className="capitalize">
                        {job.status.replace("_", " ")}
                      </Badge>
                    </div>
                    {canManage && job.status !== "closed" && (
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => closeJob(job._id)}>
                        Close Job
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-card rounded-xl card-shadow p-4">
            <p className="font-semibold mb-3">Candidate Pipeline</p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 mb-4">
              <Input
                placeholder="Search candidate by name, email, phone, skill"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              <Select value={filterJobId} onValueChange={setFilterJobId}>
                <SelectTrigger>
                  <SelectValue placeholder="All jobs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All jobs</SelectItem>
                  {jobs.map((j) => (
                    <SelectItem key={j._id} value={j._id}>
                      {j.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStage} onValueChange={setFilterStage}>
                <SelectTrigger>
                  <SelectValue placeholder="All stages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  {stageOrder.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="talent_pool">Talent Pool</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchText("");
                  setFilterJobId("all");
                  setFilterStage("all");
                  setFilterStatus("all");
                }}
              >
                Reset Filters
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Showing {filteredCandidates.length} of {(candidates || []).length} candidates
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
              {stageOrder.map((stage) => (
                <div key={stage} className="rounded-xl border bg-muted/20 p-3 min-h-[260px]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold capitalize">{stage.replace("_", " ")}</p>
                    <Badge variant="secondary">{stageBuckets[stage].length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {stageBuckets[stage].map((c) => (
                      <div key={c._id} className="rounded-md border bg-background p-2">
                        {(() => {
                          const interviews = [...(c.interviews || [])].sort(
                            (a, b) =>
                              new Date(b.scheduledAt || 0).getTime() -
                              new Date(a.scheduledAt || 0).getTime()
                          );
                          const latestInterview = interviews[0];
                          return (
                            <>
                        <p className="text-sm font-medium">
                          {`${c.firstName || ""} ${c.lastName || ""}`.trim()}
                        </p>
                        <p className="text-xs text-muted-foreground">{c.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {(c.yearsExperience || 0).toFixed(1)} yrs • Notice {c.noticePeriodDays || 0} days
                        </p>
                        {c.keySkills?.length ? (
                          <p className="text-xs text-muted-foreground">
                            Skills: {c.keySkills.slice(0, 4).join(", ")}
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-foreground mt-1">
                          Job: {typeof c.jobId === "object" ? c.jobId?.title : "-"}
                        </p>
                        {c.status === "talent_pool" && (
                          <Badge variant="secondary" className="mt-1">Talent Pool</Badge>
                        )}
                        {c.offerLetterReleasedAt && (
                          <Badge variant="secondary" className="mt-1 ml-1">Offer Sent</Badge>
                        )}
                        {c.rejectionEmailSentAt && (
                          <Badge variant="secondary" className="mt-1 ml-1">Rejected Mail Sent</Badge>
                        )}
                        {c.convertedToEmployeeId && (
                          <Badge variant="secondary" className="mt-1 ml-1">Employee Created</Badge>
                        )}
                        {latestInterview && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {latestInterview.roundName || "L1"} •{" "}
                            {latestInterview.scheduledAt
                              ? formatDateTimeInOrgTimeZone(latestInterview.scheduledAt)
                              : "-"}{" "}
                            • {latestInterview.status || "scheduled"}
                          </p>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-7 text-xs"
                          onClick={() => openCandidateDetails(c._id)}
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          View Details
                        </Button>
                        {canManage && (
                          <div className="mt-2 space-y-2">
                            <Select value={c.stage} onValueChange={(v) => moveStage(c._id, v as CandidateStage)}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {stageOrder.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {s.replace("_", " ")}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {c.stage !== "rejected" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => moveToTalentPool(c._id)}
                              >
                                Move to Pool
                              </Button>
                            )}
                            {c.stage === "offer" && (
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={Boolean(c.offerLetterReleasedAt)}
                                onClick={() => releaseOfferLetter(c._id)}
                              >
                                {c.offerLetterReleasedAt ? "Offer Released" : "Release Offer Letter"}
                              </Button>
                            )}
                            {c.stage === "rejected" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={Boolean(c.rejectionEmailSentAt)}
                                onClick={() => sendRejectionEmail(c._id)}
                              >
                                {c.rejectionEmailSentAt ? "Rejection Sent" : "Send Rejection Email"}
                              </Button>
                            )}
                            {c.stage === "hired" && (
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                disabled={Boolean(c.convertedToEmployeeId)}
                                onClick={() => openConvertDialog(c)}
                              >
                                {c.convertedToEmployeeId ? "Converted to Employee" : "Convert to Employee"}
                              </Button>
                            )}
                            {!["hired", "rejected"].includes(c.stage) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => openScheduleDialog(c._id)}
                              >
                                Schedule Interview
                              </Button>
                            )}
                            {latestInterview?._id && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => openFeedbackDialog(c._id, latestInterview._id!)}
                              >
                                Add Feedback
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-red-600 hover:text-red-700"
                              onClick={() => deleteCandidate(c._id)}
                            >
                              Remove
                            </Button>
                          </div>
                        )}
                            </>
                          );
                        })()}
                      </div>
                    ))}
                    {stageBuckets[stage].length === 0 && (
                      <p className="text-xs text-muted-foreground">No candidates</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <Dialog open={jobOpen} onOpenChange={setJobOpen}>
       <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Job Opening</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Job title" value={jobForm.title} onChange={(e) => setJobForm({ ...jobForm, title: e.target.value })} />
            <Input placeholder="Department" validationType="name" value={jobForm.department} onChange={(e) => setJobForm({ ...jobForm, department: e.target.value })} />
            <Input placeholder="Location" value={jobForm.location} onChange={(e) => setJobForm({ ...jobForm, location: e.target.value })} />
            <Input type="number" min={1} placeholder="Openings" value={jobForm.openings} onChange={(e) => setJobForm({ ...jobForm, openings: Number(e.target.value || 1) })} />
            <Select value={jobForm.employmentType} onValueChange={(v) => setJobForm({ ...jobForm, employmentType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full Time</SelectItem>
                <SelectItem value="part_time">Part Time</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
                <SelectItem value="internship">Internship</SelectItem>
              </SelectContent>
            </Select>
            <Textarea placeholder="Description" value={jobForm.description} onChange={(e) => setJobForm({ ...jobForm, description: e.target.value })} />
            <Button className="w-full" onClick={createJob}>Create Job</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={candidateOpen} onOpenChange={setCandidateOpen}>
        <DialogContent className="grid max-h-[90vh] w-[95vw] max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b bg-background px-6 py-5">
            <DialogTitle className="text-xl font-semibold">Add Candidate</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto px-6 pb-6 pt-4 custom-scroll">
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Capture interview-ready profile so rejected candidates can be reused from talent pool later.
            </div>
            <Select value={candidateForm.jobId} onValueChange={(v) => setCandidateForm({ ...candidateForm, jobId: v })}>
              <SelectTrigger><SelectValue placeholder="Select job" /></SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j._id} value={j._id}>{j.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input placeholder="First name *" validationType="name" value={candidateForm.firstName} onChange={(e) => setCandidateForm({ ...candidateForm, firstName: e.target.value })} />
              <Input placeholder="Last name" validationType="name" value={candidateForm.lastName} onChange={(e) => setCandidateForm({ ...candidateForm, lastName: e.target.value })} />
              <Input placeholder="Email *" type="email" validationType="email" value={candidateForm.email} onChange={(e) => setCandidateForm({ ...candidateForm, email: e.target.value })} />
              <Input placeholder="Phone" validationType="phone" value={candidateForm.phone} onChange={(e) => setCandidateForm({ ...candidateForm, phone: e.target.value })} />
              <Input placeholder="Current location" value={candidateForm.currentLocation} onChange={(e) => setCandidateForm({ ...candidateForm, currentLocation: e.target.value })} />
              <Input placeholder="Preferred location" value={candidateForm.preferredLocation} onChange={(e) => setCandidateForm({ ...candidateForm, preferredLocation: e.target.value })} />
              <Input type="number" min={0} step="0.1" placeholder="Years of experience" value={candidateForm.yearsExperience} onChange={(e) => setCandidateForm({ ...candidateForm, yearsExperience: Number(e.target.value || 0) })} />
              <Input type="number" min={0} placeholder="Notice period (days)" value={candidateForm.noticePeriodDays} onChange={(e) => setCandidateForm({ ...candidateForm, noticePeriodDays: Number(e.target.value || 0) })} />
              <Input placeholder="Highest qualification" value={candidateForm.highestQualification} onChange={(e) => setCandidateForm({ ...candidateForm, highestQualification: e.target.value })} />
              <Input placeholder="Specialization" value={candidateForm.specialization} onChange={(e) => setCandidateForm({ ...candidateForm, specialization: e.target.value })} />
              <Input placeholder="College/University" value={candidateForm.collegeName} onChange={(e) => setCandidateForm({ ...candidateForm, collegeName: e.target.value })} />
              <Input type="number" min={1900} max={2100} placeholder="Graduation year" value={candidateForm.graduationYear} onChange={(e) => setCandidateForm({ ...candidateForm, graduationYear: e.target.value })} />
              <Input placeholder="Current company" value={candidateForm.currentCompany} onChange={(e) => setCandidateForm({ ...candidateForm, currentCompany: e.target.value })} />
              <Input type="number" min={0} placeholder="Current CTC" value={candidateForm.currentCTC} onChange={(e) => setCandidateForm({ ...candidateForm, currentCTC: Number(e.target.value || 0) })} />
              <Input type="number" min={0} placeholder="Expected CTC" value={candidateForm.expectedCTC} onChange={(e) => setCandidateForm({ ...candidateForm, expectedCTC: Number(e.target.value || 0) })} />
              <Input placeholder="Source (portal/referral/direct)" value={candidateForm.source} onChange={(e) => setCandidateForm({ ...candidateForm, source: e.target.value })} />
              <Input placeholder="LinkedIn URL" value={candidateForm.linkedInUrl} onChange={(e) => setCandidateForm({ ...candidateForm, linkedInUrl: e.target.value })} />
              <Input placeholder="Portfolio URL" value={candidateForm.portfolioUrl} onChange={(e) => setCandidateForm({ ...candidateForm, portfolioUrl: e.target.value })} />
              <Input placeholder="Resume URL" value={candidateForm.resumeUrl} onChange={(e) => setCandidateForm({ ...candidateForm, resumeUrl: e.target.value })} />
              <Input type="date" placeholder="Next follow-up" value={candidateForm.nextFollowUpAt} onChange={(e) => setCandidateForm({ ...candidateForm, nextFollowUpAt: e.target.value })} />
            </div>
            <Input placeholder="Key skills (comma separated)" value={candidateForm.keySkillsText} onChange={(e) => setCandidateForm({ ...candidateForm, keySkillsText: e.target.value })} />
            <Textarea placeholder="Interview notes (screening summary, strengths, risks)" value={candidateForm.interviewNotes} onChange={(e) => setCandidateForm({ ...candidateForm, interviewNotes: e.target.value })} />
            <Textarea placeholder="General remarks" value={candidateForm.remarks} onChange={(e) => setCandidateForm({ ...candidateForm, remarks: e.target.value })} />
            <Select value={candidateForm.stage} onValueChange={(v) => setCandidateForm({ ...candidateForm, stage: v as CandidateStage })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {stageOrder.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={candidateForm.futureConsideration ? "yes" : "no"}
              onValueChange={(v) => setCandidateForm({ ...candidateForm, futureConsideration: v === "yes" })}
            >
              <SelectTrigger><SelectValue placeholder="Future consideration" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Keep for future roles</SelectItem>
                <SelectItem value="no">Do not keep in talent pool</SelectItem>
              </SelectContent>
            </Select>
            <Select value={candidateForm.assignedTo || "unassigned"} onValueChange={(v) => setCandidateForm({ ...candidateForm, assignedTo: v === "unassigned" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="Assign recruiter (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp._id} value={emp._id}>
                    {`${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.employeeCode || emp._id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={createCandidate}>Create Candidate</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto custom-scroll">
          <DialogHeader>
            <DialogTitle>Convert Candidate to Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Candidate: {activeCandidate ? `${activeCandidate.firstName || ""} ${activeCandidate.lastName || ""}`.trim() : "-"} ({activeCandidate?.email || "-"})
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Roles *</p>
              <div className="max-h-32 overflow-y-auto border rounded-md p-2 space-y-1">
                {roles.length === 0 && <p className="text-xs text-muted-foreground">No roles found</p>}
                {roles.map((role) => {
                  const checked = convertForm.roleIds.includes(role._id);
                  return (
                    <button
                      key={role._id}
                      type="button"
                      className={`w-full text-left px-2 py-1 rounded text-sm border ${checked ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                      onClick={() => toggleConvertRole(role._id)}
                    >
                      {role.name || role._id}
                    </button>
                  );
                })}
              </div>
            </div>
            <Select
              value={convertForm.departmentId || "none"}
              onValueChange={(v) => setConvertForm({ ...convertForm, departmentId: v === "none" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Department *" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select department</SelectItem>
                {departments.map((row) => (
                  <SelectItem key={row._id} value={row._id}>{row.name || row._id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={convertForm.designationId || "none"}
              onValueChange={(v) => setConvertForm({ ...convertForm, designationId: v === "none" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Designation *" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Select designation</SelectItem>
                {designations.map((row) => (
                  <SelectItem key={row._id} value={row._id}>{row.name || row._id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={convertForm.employmentType} onValueChange={(v) => setConvertForm({ ...convertForm, employmentType: v })}>
              <SelectTrigger><SelectValue placeholder="Employment type *" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full Time</SelectItem>
                <SelectItem value="part_time">Part Time</SelectItem>
                <SelectItem value="contract">Contract</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={convertForm.dateOfJoining}
              onChange={(e) => setConvertForm({ ...convertForm, dateOfJoining: e.target.value })}
            />
            <Select
              value={convertForm.managerId || "none"}
              onValueChange={(v) => setConvertForm({ ...convertForm, managerId: v === "none" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Manager (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No manager</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp._id} value={emp._id}>
                    {`${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.employeeCode || emp._id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={convertForm.shiftId || "none"}
              onValueChange={(v) => setConvertForm({ ...convertForm, shiftId: v === "none" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Shift (optional)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No shift</SelectItem>
                {shifts.map((row) => (
                  <SelectItem key={row._id} value={row._id}>
                    {row.name ? `${row.name}${row.startTime && row.endTime ? ` (${row.startTime}-${row.endTime})` : ""}` : row._id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="password"
              placeholder="Temporary password *"
              value={convertForm.password}
              onChange={(e) => setConvertForm({ ...convertForm, password: e.target.value })}
            />
            <Button className="w-full" onClick={convertCandidateToEmployee}>
              Convert to Employee
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Schedule Interview</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Round name (L1/L2/HR)"
              value={scheduleForm.roundName}
              onChange={(e) => setScheduleForm({ ...scheduleForm, roundName: e.target.value })}
            />
            <Input
              type="datetime-local"
              value={scheduleForm.scheduledAt}
              onChange={(e) => setScheduleForm({ ...scheduleForm, scheduledAt: e.target.value })}
            />
            <Select
              value={scheduleForm.mode}
              onValueChange={(v) => setScheduleForm({ ...scheduleForm, mode: v as "virtual" | "onsite" | "phone" })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="virtual">Virtual</SelectItem>
                <SelectItem value="onsite">Onsite</SelectItem>
                <SelectItem value="phone">Phone</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Meeting link (optional)"
              value={scheduleForm.meetingLink}
              onChange={(e) => setScheduleForm({ ...scheduleForm, meetingLink: e.target.value })}
            />
            <Select
              value={scheduleForm.interviewerEmployeeId || "unassigned"}
              onValueChange={(v) => setScheduleForm({ ...scheduleForm, interviewerEmployeeId: v === "unassigned" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="Select interviewer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp._id} value={emp._id}>
                    {`${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.employeeCode || emp._id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={scheduleInterview}>Schedule</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Interview Feedback</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="Detailed feedback"
              value={feedbackForm.feedback}
              onChange={(e) => setFeedbackForm({ ...feedbackForm, feedback: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input type="number" min={1} max={5} placeholder="Communication (1-5)" value={feedbackForm.communication} onChange={(e) => setFeedbackForm({ ...feedbackForm, communication: Number(e.target.value || 1) })} />
              <Input type="number" min={1} max={5} placeholder="Technical (1-5)" value={feedbackForm.technical} onChange={(e) => setFeedbackForm({ ...feedbackForm, technical: Number(e.target.value || 1) })} />
              <Input type="number" min={1} max={5} placeholder="Problem Solving (1-5)" value={feedbackForm.problemSolving} onChange={(e) => setFeedbackForm({ ...feedbackForm, problemSolving: Number(e.target.value || 1) })} />
              <Input type="number" min={1} max={5} placeholder="Culture Fit (1-5)" value={feedbackForm.cultureFit} onChange={(e) => setFeedbackForm({ ...feedbackForm, cultureFit: Number(e.target.value || 1) })} />
              <Input type="number" min={1} max={5} placeholder="Overall (1-5)" value={feedbackForm.overall} onChange={(e) => setFeedbackForm({ ...feedbackForm, overall: Number(e.target.value || 1) })} />
            </div>
            <Select
              value={feedbackForm.recommendation}
              onValueChange={(v) => setFeedbackForm({ ...feedbackForm, recommendation: v as any })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="strong_hire">Strong Hire</SelectItem>
                <SelectItem value="hire">Hire</SelectItem>
                <SelectItem value="hold">Hold</SelectItem>
                <SelectItem value="reject">Reject</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={feedbackForm.status}
              onValueChange={(v) => setFeedbackForm({ ...feedbackForm, status: v as any })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="scheduled">Scheduled</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={submitInterviewFeedback}>Submit Feedback</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Candidate Details</SheetTitle>
            <SheetDescription>Full profile for interview and future consideration</SheetDescription>
          </SheetHeader>
          {!selectedCandidate && (
            <p className="text-sm text-muted-foreground mt-4">Candidate details not found.</p>
          )}
          {selectedCandidate && (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border p-3">
                <p className="text-lg font-semibold">
                  {`${selectedCandidate.firstName || ""} ${selectedCandidate.lastName || ""}`.trim()}
                </p>
                <p className="text-sm text-muted-foreground">{selectedCandidate.email}</p>
                <p className="text-sm text-muted-foreground">
                  {selectedCandidate.phone || "-"} • {(selectedCandidate.yearsExperience || 0).toFixed(1)} yrs
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge className="capitalize">{selectedCandidate.stage}</Badge>
                  <Badge variant="secondary" className="capitalize">
                    {selectedCandidate.status || "active"}
                  </Badge>
                  {selectedCandidate.offerLetterReleasedAt && <Badge variant="secondary">Offer Sent</Badge>}
                  {selectedCandidate.rejectionEmailSentAt && (
                    <Badge variant="secondary">Rejection Sent</Badge>
                  )}
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <p><span className="font-medium">Job:</span> {typeof selectedCandidate.jobId === "object" ? selectedCandidate.jobId?.title : "-"}</p>
                <p><span className="font-medium">Qualification:</span> {selectedCandidate.highestQualification || "-"}</p>
                <p><span className="font-medium">Current Location:</span> {selectedCandidate.currentLocation || "-"}</p>
                <p><span className="font-medium">Preferred Location:</span> {selectedCandidate.preferredLocation || "-"}</p>
                <p><span className="font-medium">Notice Period:</span> {selectedCandidate.noticePeriodDays || 0} days</p>
                <p><span className="font-medium">Expected CTC:</span> {selectedCandidate.expectedCTC || 0}</p>
                <p><span className="font-medium">LinkedIn:</span> {selectedCandidate.linkedInUrl || "-"}</p>
                <p><span className="font-medium">Resume:</span> {selectedCandidate.resumeUrl || "-"}</p>
                <p><span className="font-medium">Future Consideration:</span> {selectedCandidate.futureConsideration ? "Yes" : "No"}</p>
                {selectedCandidate.keySkills?.length ? (
                  <p>
                    <span className="font-medium">Skills:</span> {selectedCandidate.keySkills.join(", ")}
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border p-3">
                <p className="font-medium mb-2">Interview Timeline</p>
                {(selectedCandidate.interviews || []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No interviews scheduled.</p>
                )}
                <div className="space-y-2">
                  {[...(selectedCandidate.interviews || [])]
                    .sort((a, b) => new Date(b.scheduledAt || 0).getTime() - new Date(a.scheduledAt || 0).getTime())
                    .map((interview) => (
                      <div key={interview._id || `${interview.roundName}-${interview.scheduledAt}`} className="rounded-md border p-2 text-sm">
                        <p className="font-medium">
                          {interview.roundName || "Round"} • {interview.status || "scheduled"}
                        </p>
                        <p className="text-muted-foreground">
                          {interview.scheduledAt ? formatDateTimeInOrgTimeZone(interview.scheduledAt) : "-"} • {interview.mode || "-"}
                        </p>
                        {interview.feedback ? (
                          <p className="text-muted-foreground mt-1">Feedback: {interview.feedback}</p>
                        ) : null}
                        {interview.recommendation ? (
                          <p className="text-muted-foreground">Recommendation: {interview.recommendation.replace("_", " ")}</p>
                        ) : null}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default Hiring;
