import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { postApiWithoutToken } from "@/services/apiWrapper";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Step = "email" | "otp" | "password";

const ForgotPassword = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [submitting, setSubmitting] = useState(false);

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error("Email is required");
      return;
    }

    setSubmitting(true);
    const response: any = await postApiWithoutToken("/users/forgot-password/send-otp", { email });
    setSubmitting(false);

    if (response?.success) {
      toast.success(response?.message || "OTP sent successfully");
      setStep("otp");
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
    const response: any = await postApiWithoutToken("/users/forgot-password/verify-otp", {
      email,
      otp
    });
    setSubmitting(false);

    if (response?.success) {
      toast.success(response?.message || "OTP verified successfully");
      setStep("password");
      return;
    }
    toast.error(response?.message || "OTP verification failed");
  };

  const handleResetPassword = async (e: React.FormEvent) => {
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
    const response: any = await postApiWithoutToken("/users/forgot-password/reset-password", {
      email,
      password,
      confirmPassword
    });
    setSubmitting(false);

    if (response?.success) {
      toast.success(response?.message || "Password updated successfully");
      navigate("/login", { replace: true });
      return;
    }
    toast.error(response?.message || "Failed to update password");
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border bg-white shadow-xl p-6 sm:p-8">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-blue-600">Password Recovery</p>
        <h1 className="text-2xl font-semibold mt-2 text-slate-900">Forgot password</h1>
        <p className="text-sm text-slate-500 mt-2">
          {step === "email" && "Enter your registered email to receive OTP."}
          {step === "otp" && "Enter the 6-digit OTP sent to your email."}
          {step === "password" && "Set your new password."}
        </p>

        {step === "email" && (
          <form className="mt-6 space-y-4" onSubmit={handleSendOtp}>
            <Input
              type="email"
              placeholder="Work email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11"
            />
            <Button type="submit" className="w-full h-11" disabled={submitting}>
              {submitting ? "Sending OTP..." : "Send OTP"}
            </Button>
          </form>
        )}

        {step === "otp" && (
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
              onClick={() => setStep("email")}
            >
              Change Email
            </Button>
          </form>
        )}

        {step === "password" && (
          <form className="mt-6 space-y-4" onSubmit={handleResetPassword}>
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

        <p className="text-sm text-slate-500 mt-6 text-center">
          Back to{" "}
          <Link className="text-blue-600 hover:text-blue-700 font-medium" to="/login">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPassword;
