import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import { getApiWithToken, postApiWithoutToken, switchRole } from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { getIsSuperAdmin, getToken, setAdminRoleId, setAdminUserId, setIsSuperAdmin, setToken } from "@/utils/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, Clock3, Users2, CalendarCheck2, Sparkles, Camera } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { InlineLoader } from "@/components/ui/loaders";

const slides = [
  {
    title: "One Workspace For Your Entire Team",
    description:
      "Upanaya HRMS unifies employee data, attendance, leaves, approvals, and documentation in one reliable system.",
    metric: "42% faster HR operations"
  },
  {
    title: "Faster Attendance and Shift Operations",
    description:
      "Track check-in and check-out, shifts, week offs, holidays, and corrections with complete visibility.",
    metric: "99.9% attendance traceability"
  },
  {
    title: "Smarter Leave and Approval Controls",
    description:
      "Automate leave balances, approval flows, and role-based actions so requests move quickly and correctly.",
    metric: "3x faster request approvals"
  },
  {
    title: "Reliable Insights For Managers",
    description:
      "Use dashboards, attendance matrix, and timesheet views to monitor performance and team health daily.",
    metric: "Single-view team visibility"
  },
  {
    title: "Built For Scale and Governance",
    description:
      "Permission-aware modules and organization-level controls help run HR operations securely across teams.",
    metric: "Enterprise-ready controls"
  }
];

const captureSelfieForLogin = async (titleText = "Take Selfie For Login"): Promise<string | null> => {
  if (!navigator.mediaDevices?.getUserMedia) return null;

  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "9999";
    overlay.style.background = "rgba(0,0,0,0.8)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";

    const card = document.createElement("div");
    card.style.background = "#fff";
    card.style.padding = "12px";
    card.style.borderRadius = "12px";
    card.style.width = "min(92vw, 420px)";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "10px";

    const title = document.createElement("div");
    title.textContent = titleText;
    title.style.fontWeight = "600";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.style.width = "100%";
    video.style.borderRadius = "8px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.justifyContent = "flex-end";

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.style.padding = "8px 10px";

    const capture = document.createElement("button");
    capture.textContent = "Capture";
    capture.style.padding = "8px 10px";

    const cleanup = () => {
      stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
    };

    cancel.onclick = () => {
      cleanup();
      resolve(null);
    };

    capture.onclick = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      cleanup();
      resolve(dataUrl);
    };

    actions.append(cancel, capture);
    card.append(title, video, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
};

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setProfile, setPermissions, loadProfile } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submittingMode, setSubmittingMode] = useState<null | "password" | "selfie">(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const searchParams = new URLSearchParams(location.search);
  const sessionExpired = searchParams.get("reason") === "session_expired";

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % slides.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const activeToken = getToken();
    if (!activeToken) return;
    navigate(getIsSuperAdmin() ? "/superadmin" : "/", { replace: true });
  }, [navigate]);

  const completeLogin = async (response: any) => {
    if (response.code !== 200) {
      toast.warning(response.message || "Login failed");
      return;
    }

    const { roles, activeRole } = response.data;
    const resolvedActiveRole = activeRole || roles?.[0] || null;
    const authToken = response?.data?.token;

    if (authToken) {
      setToken(authToken);
    }

    setProfile({
      ...response.data,
      activeRole: resolvedActiveRole
    });

    const isSuperAdmin =
      resolvedActiveRole?.slug === "superadmin" ||
      roles?.some((role: any) => role.slug === "superadmin");

    const mustChangePassword = Boolean(response?.data?.mustChangePassword);

    if (mustChangePassword) {
      setPermissions([]);
      toast.info("Please change your password to continue.");
      navigate("/change-password", { replace: true });
      return;
    }

    const activeRoleId = resolvedActiveRole?._id || null;

    const loadPermissionsForActiveRole = async () => {
      try {
        const permRes: any = await getApiWithToken("/users/me/permissions");
        if (permRes?.success) {
          return permRes.data || [];
        }

        const message = String(permRes?.message || "").toLowerCase();
        if (permRes?.code === 403 && message.includes("active role not set") && activeRoleId) {
          const switchRes: any = await switchRole(String(activeRoleId));
          const switchedToken = switchRes?.data?.token;
          if (switchedToken) {
            setToken(switchedToken);
          }
          const retryPermRes: any = await getApiWithToken("/users/me/permissions");
          if (retryPermRes?.success) {
            return retryPermRes.data || [];
          }
        }
      } catch {
        // handled below
      }

      return [];
    };

    try {
      const [permissionsData] = await Promise.all([
        loadPermissionsForActiveRole(),
        loadProfile()
      ]);
      setPermissions(permissionsData);

      if (!resolvedActiveRole && permissionsData.length === 0) {
        toast.info("Your account does not have an assigned role yet. Please complete your profile.");
        setIsSuperAdmin(false);
        setAdminUserId(null);
        setAdminRoleId(null);
        navigate("/complete-profile", { replace: true });
        return;
      }

      const employeeRes = await getApiWithToken("/employees/me");
      const profileCompleted = employeeRes?.success && employeeRes?.data?.profileCompleted !== false;

      if (!isSuperAdmin && !profileCompleted) {
        toast.success("Logged in successfully!");
        setIsSuperAdmin(isSuperAdmin);
        setAdminUserId(null);
        setAdminRoleId(null);
        navigate("/complete-profile", { replace: true });
        return;
      }
    } catch {
      setPermissions([]);
    }
    toast.success("Logged in successfully!");

    setIsSuperAdmin(isSuperAdmin);

    if (isSuperAdmin) {
      setAdminUserId(response.data.userId || null);
      setAdminRoleId(response.data.roles?.[0]?._id || null);
      navigate("/dashboard", { replace: true });
    } else {
      setAdminUserId(null);
      setAdminRoleId(null);
      navigate("/", { replace: true });
    }
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    const formData = new FormData(e.currentTarget);
    const submittedEmail = String(formData.get("email") || email || "").trim().toLowerCase();
    const submittedPassword = String(formData.get("password") || password || "");

    if (!submittedEmail || !submittedPassword) {
      setError("Email and password are required");
      return;
    }

    try {
      setSubmittingMode("password");
      const response: any = await postApiWithoutToken("/users/login", {
        email: submittedEmail,
        password: submittedPassword
      });
      await completeLogin(response);
    } catch {
      toast.error("Login failed");
    } finally {
      setSubmittingMode(null);
    }
  };

  const handleSelfieLogin = async () => {
    setError("");
    const submittedEmail = String(email || "").trim().toLowerCase();
    const submittedPassword = String(password || "");

    if (!submittedEmail || !submittedPassword) {
      setError("Email and password are required");
      return;
    }

    try {
      setSubmittingMode("selfie");
      const selfieImage = await captureSelfieForLogin("Step 1/2: Capture selfie with eyes open");
      if (!selfieImage) {
        toast.warning("Selfie capture cancelled");
        return;
      }
      const livenessSelfieImage = await captureSelfieForLogin("Step 2/2: Capture selfie with eyes closed");
      if (!livenessSelfieImage) {
        toast.warning("Liveness selfie capture cancelled");
        return;
      }
      const response: any = await postApiWithoutToken("/users/login/selfie", {
        email: submittedEmail,
        password: submittedPassword,
        selfieImage,
        livenessSelfieImage
      });
      if (response?.code === 200 && response?.data?.selfieVerificationBypassed) {
        toast.warning(
          response?.data?.selfieVerificationBypassReason
            ? `Face verification bypassed: ${response.data.selfieVerificationBypassReason}`
            : "Face verification bypassed due to provider unavailability"
        );
      }
      await completeLogin(response);
    } catch {
      toast.error("Selfie login failed");
    } finally {
      setSubmittingMode(null);
    }
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-slate-950">
      <section className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-blue-800 via-blue-700 to-cyan-700 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(255,255,255,0.22),transparent_25%),radial-gradient(circle_at_85%_85%,rgba(125,211,252,0.25),transparent_35%)]" />
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/20 blur-2xl" />
        <div className="absolute -bottom-28 -right-20 h-96 w-96 rounded-full bg-cyan-200/20 blur-3xl" />

        <div className="relative z-10 w-full p-14 flex flex-col">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-blue-100/90">Upanaya HRMS Platform</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight max-w-[18ch]">
              Human resources, reimagined for real operations
            </h1>
            <div className="mt-6 grid grid-cols-2 gap-3 max-w-lg">
              <div className="rounded-xl bg-white/10 border border-white/20 p-3">
                <p className="text-xs text-blue-100">Attendance Engine</p>
                <p className="font-semibold mt-1 flex items-center gap-2"><Clock3 className="w-4 h-4" /> Real-time</p>
              </div>
              <div className="rounded-xl bg-white/10 border border-white/20 p-3">
                <p className="text-xs text-blue-100">Access Governance</p>
                <p className="font-semibold mt-1 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Role-based</p>
              </div>
            </div>
          </div>

          <div className="mt-auto">
            <div className="rounded-2xl border border-white/25 bg-white/10 backdrop-blur p-7 min-h-[250px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={slideIndex}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.35 }}
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-blue-100/85 flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5" /> Why teams choose us
                  </p>
                  <p className="text-2xl font-semibold mt-2">{slides[slideIndex].title}</p>
                  <p className="mt-3 text-blue-50/95 leading-relaxed">{slides[slideIndex].description}</p>
                  <div className="mt-4 inline-flex rounded-full border border-cyan-200/35 bg-cyan-100/10 px-3 py-1 text-sm font-medium">
                    {slides[slideIndex].metric}
                  </div>
                </motion.div>
              </AnimatePresence>

              <div className="mt-6 flex items-center gap-2">
                {slides.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSlideIndex(idx)}
                    className={`h-2.5 rounded-full transition-all ${
                      idx === slideIndex ? "w-8 bg-white" : "w-2.5 bg-white/45 hover:bg-white/80"
                    }`}
                    aria-label={`Go to slide ${idx + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-8 bg-slate-100">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6 sm:p-8">
          <div className="mb-6">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-blue-600">Welcome Back</p>
            <h2 className="text-2xl font-semibold mt-2 text-slate-900">Sign in to Upanaya HRMS</h2>
            <p className="text-sm text-slate-500 mt-2">Manage attendance, leaves, approvals, and people operations in one place.</p>
          </div>

          {error && (
            <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}
          {!error && sessionExpired && (
            <p className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Your session has expired. Please login again.
            </p>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <Input
              type="email"
              name="email"
              autoComplete="username"
              placeholder="Work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
            <Input
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
            />
            <div className="text-right -mt-2">
              <Link to="/forgot-password" className="text-sm text-blue-600 hover:text-blue-700">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" className="w-full h-11" disabled={Boolean(submittingMode)}>
              {submittingMode === "password" ? <InlineLoader label="Signing in..." className="text-white" /> : "Login"}
            </Button>
            <Button type="button" variant="outline" className="w-full h-11" disabled={Boolean(submittingMode)} onClick={handleSelfieLogin}>
              {submittingMode === "selfie" ? <InlineLoader label="Verifying selfie..." /> : <span className="inline-flex items-center gap-2"><Camera className="w-4 h-4" /> Login with Selfie</span>}
            </Button>
          </form>

          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border bg-slate-50 py-2 px-1">
              <Users2 className="w-4 h-4 mx-auto text-slate-600" />
              <p className="text-[11px] text-slate-500 mt-1">Employees</p>
            </div>
            <div className="rounded-lg border bg-slate-50 py-2 px-1">
              <CalendarCheck2 className="w-4 h-4 mx-auto text-slate-600" />
              <p className="text-[11px] text-slate-500 mt-1">Attendance</p>
            </div>
            <div className="rounded-lg border bg-slate-50 py-2 px-1">
              <ShieldCheck className="w-4 h-4 mx-auto text-slate-600" />
              <p className="text-[11px] text-slate-500 mt-1">Secure</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Login;
