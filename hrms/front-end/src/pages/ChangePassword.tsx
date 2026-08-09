import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { postApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { useAuth } from "@/context/useAuth";
import { useNavigate } from "react-router-dom";

type Step = "send" | "verify" | "update";

const ChangePassword = () => {
  const { profile, setProfile } = useAuth();
  const navigate = useNavigate();
  const isFirstLoginPasswordReset = Boolean(profile?.mustChangePassword);
  const [step, setStep] = useState<Step>("send");
  const [submitting, setSubmitting] = useState(false);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const email = profile?.email || "your registered email";

  const handleSendOtp = async () => {
    setSubmitting(true);
    const response: any = await postApiWithToken("/users/change-password/send-otp", {});
    setSubmitting(false);
    if (response?.success) {
      toast.success(response?.message || "OTP sent successfully");
      setStep("verify");
      return;
    }
    toast.error(response?.message || "Failed to send OTP");
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp || otp.length !== 6) {
      toast.error("Enter valid 6-digit OTP");
      return;
    }
    setSubmitting(true);
    const response: any = await postApiWithToken("/users/change-password/verify-otp", { otp });
    setSubmitting(false);
    if (response?.success) {
      toast.success(response?.message || "OTP verified successfully");
      setStep("update");
      return;
    }
    toast.error(response?.message || "OTP verification failed");
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !confirmPassword) {
      toast.error("Password and confirm password are required");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Confirm password must match password");
      return;
    }

    setSubmitting(true);
    const response: any = await postApiWithToken("/users/change-password/update", {
      password,
      confirmPassword
    });
    setSubmitting(false);

    if (response?.success) {
      toast.success(response?.message || "Password updated successfully");
      setProfile({
        ...(profile || {}),
        mustChangePassword: false
      });
      setOtp("");
      setPassword("");
      setConfirmPassword("");
      setStep("send");
      navigate("/", { replace: true });
      return;
    }
    toast.error(response?.message || "Failed to update password");
  };

  return (
    <MainLayout title="Change Password" breadcrumb={[{ label: "Home" }, { label: "Change Password" }]}>
      <div className="max-w-xl rounded-xl border bg-card shadow-sm p-6">
        <h2 className="text-xl font-semibold text-foreground">Update your password</h2>
        <p className="text-sm text-muted-foreground mt-2">
          OTP will be sent to <span className="font-medium">{email}</span>.
        </p>
        {isFirstLoginPasswordReset && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Password expired. Password update is required before accessing the dashboard.
          </div>
        )}

        {step === "send" && (
          <div className="mt-6 space-y-4">
            <Button className="w-full h-11" disabled={submitting} onClick={handleSendOtp}>
              {submitting ? "Sending OTP..." : "Send OTP"}
            </Button>
          </div>
        )}

        {step === "verify" && (
          <form className="mt-6 space-y-4" onSubmit={handleVerifyOtp}>
            <Input
              type="text"
              maxLength={6}
              placeholder="Enter 6-digit OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              className="h-11 tracking-[0.35em]"
            />
            <Button type="submit" className="w-full h-11" disabled={submitting}>
              {submitting ? "Verifying OTP..." : "Verify OTP"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full h-11"
              disabled={submitting}
              onClick={() => setStep("send")}
            >
              Send OTP again
            </Button>
          </form>
        )}

        {step === "update" && (
          <form className="mt-6 space-y-4" onSubmit={handleUpdatePassword}>
            <Input
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11"
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11"
            />
            <Button type="submit" className="w-full h-11" disabled={submitting}>
              {submitting ? "Updating Password..." : "Update Password"}
            </Button>
          </form>
        )}
      </div>
    </MainLayout>
  );
};

export default ChangePassword;
