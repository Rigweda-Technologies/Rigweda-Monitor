import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import { getApiWithToken, postApiWithoutToken, switchRole } from "@/services/apiWrapper";
import { useAuth } from "@/context/useAuth";
import { getIsSuperAdmin, getToken, setAdminRoleId, setAdminUserId, setIsSuperAdmin, setToken } from "@/utils/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Activity, Users2, Laptop, Sparkles, Camera, Monitor, HardDrive, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { InlineLoader } from "@/components/ui/loaders";

const slides = [
  {
    title: "See Work Clearly, Without Guesswork",
    description:
      "Monitor employee activity, application usage, browser activity, and screenshots in one focused workspace.",
    metric: "One view for every monitored device"
  },
  {
    title: "Know Which Devices Need Attention",
    description:
      "Track laptop health, memory, storage, temperature, uptime, and installed agent versions before small issues become blockers.",
    metric: "Live laptop health snapshots"
  },
  {
    title: "Review Activity With Context",
    description:
      "Move from an employee row directly to the activity, app usage, browser history, or screenshots that explain the workday.",
    metric: "Activity, apps, history, screenshots"
  },
  {
    title: "Ship Agent Updates Safely",
    description:
      "Manage desktop builds, rollout status, checksums, testing, activation, and downloads from one release console.",
    metric: "Controlled desktop rollouts"
  },
  {
    title: "Monitoring With Boundaries",
    description:
      "Permission-aware access and organization-level controls keep monitoring data visible only to the people who need it.",
    metric: "Secure, role-based visibility"
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
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[1.12fr_0.88fr] bg-slate-950">
      <section className="hidden lg:flex relative overflow-hidden bg-[#071b2d] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(45,212,191,0.28),transparent_28%),radial-gradient(circle_at_88%_82%,rgba(56,189,248,0.2),transparent_32%)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px)] [background-size:42px_42px]" />
        <div className="absolute -top-28 -left-20 h-80 w-80 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-20 h-[28rem] w-[28rem] rounded-full bg-sky-400/15 blur-3xl" />

        <div className="relative z-10 w-full p-14 flex flex-col">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-teal-200/30 bg-teal-300/15 text-teal-200"><Monitor className="h-5 w-5" /></div>
              <p className="text-xs uppercase tracking-[0.24em] text-teal-100/90">Workforce Monitor</p>
            </div>
            <h1 className="mt-7 text-5xl font-semibold leading-[1.05] max-w-[15ch]">
              Visibility for every workday.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">A focused command center for employee activity, device health, screenshots, and desktop agent operations.</p>
            <div className="mt-7 grid grid-cols-3 gap-3 max-w-2xl">
              <div className="rounded-2xl border border-teal-200/20 bg-white/[0.07] p-4 backdrop-blur">
                <Activity className="h-5 w-5 text-teal-300" />
                <p className="mt-4 text-sm font-semibold">Live activity</p>
                <p className="mt-1 text-xs text-slate-400">Apps and usage</p>
              </div>
              <div className="rounded-2xl border border-sky-200/20 bg-white/[0.07] p-4 backdrop-blur">
                <Laptop className="h-5 w-5 text-sky-300" />
                <p className="mt-4 text-sm font-semibold">Device health</p>
                <p className="mt-1 text-xs text-slate-400">RAM and storage</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/[0.07] p-4 backdrop-blur">
                <HardDrive className="h-5 w-5 text-amber-300" />
                <p className="mt-4 text-sm font-semibold">Agent control</p>
                <p className="mt-1 text-xs text-slate-400">Safe releases</p>
              </div>
            </div>
          </div>

          <div className="mt-auto">
            <div className="rounded-3xl border border-white/15 bg-slate-900/55 backdrop-blur p-7 min-h-[250px] shadow-2xl shadow-slate-950/20">
              <AnimatePresence mode="wait">
                <motion.div
                  key={slideIndex}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.35 }}
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-teal-200/85 flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5" /> Monitor intelligence
                  </p>
                  <p className="text-2xl font-semibold mt-2">{slides[slideIndex].title}</p>
                  <p className="mt-3 text-slate-300 leading-relaxed">{slides[slideIndex].description}</p>
                  <div className="mt-4 inline-flex rounded-full border border-teal-200/25 bg-teal-300/10 px-3 py-1 text-sm font-medium text-teal-100">
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

      <section className="relative flex items-center justify-center overflow-hidden p-5 sm:p-8 bg-[#f4f8fa]">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-teal-100/70 blur-3xl" />
        <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-3xl shadow-[0_24px_70px_rgba(15,23,42,0.12)] p-6 sm:p-8">
          <div className="mb-6">
            <div className="flex items-center gap-2 text-teal-700"><Monitor className="h-4 w-4" /><p className="text-xs font-semibold uppercase tracking-[0.22em]">Monitor console</p></div>
            <h2 className="text-2xl font-semibold mt-3 text-slate-900">Sign in to your workspace</h2>
            <p className="text-sm text-slate-500 mt-2">Review activity, screenshots, laptop health, and agent releases from one secure workspace.</p>
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
              <Link to="/forgot-password" className="text-sm text-emerald-600 hover:text-emerald-700">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" className="w-full h-11 bg-teal-600 hover:bg-teal-700" disabled={Boolean(submittingMode)}>
              {submittingMode === "password" ? <InlineLoader label="Signing in..." className="text-white" /> : "Login"}
            </Button>
            <Button type="button" variant="outline" className="w-full h-11" disabled={Boolean(submittingMode)} onClick={handleSelfieLogin}>
              {submittingMode === "selfie" ? <InlineLoader label="Verifying selfie..." /> : <span className="inline-flex items-center gap-2"><Camera className="w-4 h-4" /> Login with Selfie</span>}
            </Button>
          </form>

          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-slate-200 bg-slate-50 py-3 px-1">
              <Users2 className="w-4 h-4 mx-auto text-teal-700" />
              <p className="text-[11px] text-slate-500 mt-1">Activity</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 py-3 px-1">
              <Laptop className="w-4 h-4 mx-auto text-teal-700" />
              <p className="text-[11px] text-slate-500 mt-1">Health</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 py-3 px-1">
              <Download className="w-4 h-4 mx-auto text-teal-700" />
              <p className="text-[11px] text-slate-500 mt-1">Releases</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Login;
