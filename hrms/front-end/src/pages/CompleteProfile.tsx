import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PROOF_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const RELATION_OPTIONS = [
  { label: "Father", value: "father" },
  { label: "Mother", value: "mother" },
  { label: "Spouse", value: "spouse" },
  { label: "Brother", value: "brother" },
  { label: "Sister", value: "sister" },
  { label: "Son", value: "son" },
  { label: "Daughter", value: "daughter" },
  { label: "Guardian", value: "guardian" },
  { label: "Friend", value: "friend" },
  { label: "Other", value: "other" }
];
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const sanitizePlaceName = (value: string) => value.replace(/[^A-Za-z .'-]/g, "");
const isValidPlaceName = (value: string) => /^[A-Za-z]+(?:[A-Za-z .'-]*[A-Za-z])?$/.test(value.trim());

const CompleteProfile = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState("");

  const [form, setForm] = useState({
    phone: "",
    dob: "",
    gender: "",
    aadhaarNumber: "",
    panNumber: "",
    address: {
      line1: "",
      line2: "",
      city: "",
      state: "",
      country: "",
      zip: ""
    },
    emergencyContacts: [
      { name: "", relation: "", phone: "" }
    ],
    profileImageUpload: null as null | { fileName: string; mimeType: string; base64Data: string },
    addressProofUpload: null as null | { fileName: string; mimeType: string; base64Data: string },
    aadhaarProofUpload: null as null | { fileName: string; mimeType: string; base64Data: string },
    panProofUpload: null as null | { fileName: string; mimeType: string; base64Data: string }
  });

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const base64 = result.includes(",") ? result.split(",")[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const validateFile = (file: File, allowedTypes: string[], maxBytes: number, label: string) => {
    if (!allowedTypes.includes(file.type)) {
      toast.error(`Invalid ${label} format`);
      return false;
    }
    if (file.size > maxBytes) {
      toast.error(`${label} size should be under ${Math.floor(maxBytes / (1024 * 1024))}MB`);
      return false;
    }
    return true;
  };

  const fetchProfile = async () => {
    const res = await getApiWithToken("/employees/me");
    if (res?.success) {
      setProfile(res.data);
      setForm((prev) => ({
        ...prev,
        phone: res.data.phone || "",
        dob: res.data.dob ? new Date(res.data.dob).toISOString().slice(0, 10) : "",
        gender: res.data.gender || "",
        aadhaarNumber: res.data.aadhaarNumber || "",
        panNumber: res.data.panNumber || "",
        address: res.data.address || prev.address
      }));
    }
  };


  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSubmit = async () => {
    if (!form.phone || !form.dob || !form.gender) {
      toast.error("Phone, DOB and gender are required");
      return;
    }
    if (!INDIAN_MOBILE_REGEX.test(form.phone.trim())) {
      toast.error("Phone number must be a valid 10-digit Indian mobile number");
      return;
    }
    if (form.aadhaarNumber.trim() && !/^\d{12}$/.test(form.aadhaarNumber.trim())) {
      toast.error("Aadhaar number must be 12 digits");
      return;
    }
    if (form.panNumber.trim() && !/^[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}$/.test(form.panNumber.trim())) {
      toast.error("PAN number format is invalid");
      return;
    }
    if (
      !form.address.line1.trim()
      || !form.address.city.trim()
      || !form.address.state.trim()
      || !form.address.country.trim()
      || !form.address.zip.trim()
    ) {
      toast.error("Address Line 1, City, State, Country and Zip are required");
      return;
    }
    if (!/^\d+$/.test(form.address.zip.trim())) {
      toast.error("PIN/Zip code must contain only numbers");
      return;
    }
    if (!isValidPlaceName(form.address.city)) {
      toast.error("City must contain only letters");
      return;
    }
    if (!isValidPlaceName(form.address.state)) {
      toast.error("State must contain only letters");
      return;
    }
    if (!isValidPlaceName(form.address.country)) {
      toast.error("Country must contain only letters");
      return;
    }
    const emergency = form.emergencyContacts[0];
    const hasEmergencyValue = Boolean(emergency?.name || emergency?.relation || emergency?.phone);
    if (hasEmergencyValue) {
      if (!emergency?.name || !emergency?.relation || !emergency?.phone) {
        toast.error("Complete all emergency contact fields");
        return;
      }
      if (!/^[A-Za-z ]{2,50}$/.test(emergency.name.trim())) {
        toast.error("Emergency contact name should contain only letters (2-50 chars)");
        return;
      }
      if (!INDIAN_MOBILE_REGEX.test(emergency.phone.trim())) {
        toast.error("Emergency contact mobile number must be a valid 10-digit Indian mobile number");
        return;
      }
    }

    setLoading(true);
    const payload = {
      phone: form.phone,
      dob: form.dob,
      gender: form.gender,
      aadhaarNumber: form.aadhaarNumber.trim(),
      panNumber: form.panNumber.trim().toUpperCase(),
      address: form.address,
      emergencyContacts: form.emergencyContacts.filter((c) => c.name && c.relation && c.phone),
      profileImageUpload: form.profileImageUpload || undefined,
      addressProofUpload: form.addressProofUpload || undefined,
      aadhaarProofUpload: form.aadhaarProofUpload || undefined,
      panProofUpload: form.panProofUpload || undefined
    };

    const res = await putApiWithToken("/employees/me/profile", payload);
    setLoading(false);
    if (res?.success) {
      toast.success("Profile completed");
      navigate("/", { replace: true });
    } else {
      toast.error(res?.message || "Failed to save profile");
    }
  };

  return (
    <MainLayout title="Complete Profile" breadcrumb={[{ label: "Home" }, { label: "Complete Profile" }]}>
      <div className="max-w-5xl space-y-6">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-r from-white via-blue-50/60 to-cyan-50/40 p-6">
          <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-blue-200/30 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">
                Complete Your Profile{profile?.firstName ? `, ${profile.firstName}` : ""}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Add your personal and KYC details to activate your employee account.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-16 w-16 overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm">
                {(profilePreviewUrl || profile?.profileImage) ? (
                  <img src={profilePreviewUrl || profile?.profileImage} alt="Profile preview" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">No Image</div>
                )}
              </div>
              <div className="text-xs text-slate-500">
                Employee ID: <span className="font-medium text-slate-700">{profile?.employeeCode || "-"}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-base font-semibold text-slate-900">Personal Details</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Work Email</label>
                <Input value={profile?.userId?.email || ""} disabled />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">First Name</label>
                <Input value={profile?.firstName || ""} disabled />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Last Name</label>
                <Input value={profile?.lastName || ""} disabled />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Phone</label>
                <Input
                  validationType="phone"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Date of Birth</label>
                <Input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Gender</label>
                <Select value={form.gender} onValueChange={(value) => setForm({ ...form, gender: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Aadhaar Number</label>
                <Input
                  value={form.aadhaarNumber}
                  onChange={(e) => setForm({ ...form, aadhaarNumber: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                  placeholder="12 digit Aadhaar number"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">PAN Number</label>
                <Input
                  value={form.panNumber}
                  onChange={(e) => setForm({ ...form, panNumber: e.target.value.toUpperCase() })}
                  placeholder="ABCDE1234F"
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-base font-semibold text-slate-900">Work Details</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Department</label>
                <Input value={profile?.departmentId?.name || ""} disabled />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Designation</label>
                <Input value={profile?.designationId?.name || ""} disabled />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Employment Type</label>
                <Input value={profile?.employmentType || ""} disabled />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Date of Joining</label>
                <Input value={profile?.dateOfJoining ? new Date(profile.dateOfJoining).toISOString().slice(0, 10) : ""} disabled />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Reporting Manager</label>
                <Input
                  value={profile?.managerId ? `${profile.managerId.firstName || ""} ${profile.managerId.lastName || ""}`.trim() : ""}
                  disabled
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Profile Picture (optional)</label>
                <Input
                  type="file"
                  accept="image/*"
                  aria-label="Choose profile picture file"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!validateFile(file, PROFILE_IMAGE_TYPES, PROFILE_IMAGE_MAX_BYTES, "Profile image")) return;
                    const base64Data = await fileToBase64(file);
                    setProfilePreviewUrl(URL.createObjectURL(file));
                    setForm({
                      ...form,
                      profileImageUpload: {
                        fileName: file.name,
                        mimeType: file.type,
                        base64Data
                      }
                    });
                  }}
                />
                <p className="mt-1 text-xs text-slate-500">Choose profile picture file (JPG, PNG, WEBP up to 2MB)</p>
              </div>
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-slate-900">Address Details</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Address Line 1</label>
              <Input value={form.address.line1} onChange={(e) => setForm({ ...form, address: { ...form.address, line1: e.target.value } })} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Address Line 2 (optional)</label>
              <Input value={form.address.line2} onChange={(e) => setForm({ ...form, address: { ...form.address, line2: e.target.value } })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">City</label>
              <Input
                value={form.address.city}
                placeholder="Enter city"
                onChange={(e) => setForm({ ...form, address: { ...form.address, city: sanitizePlaceName(e.target.value) } })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">State</label>
              <Input
                value={form.address.state}
                placeholder="Enter state"
                onChange={(e) => setForm({ ...form, address: { ...form.address, state: sanitizePlaceName(e.target.value) } })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Country</label>
              <Input
                value={form.address.country}
                placeholder="Enter country"
                onChange={(e) => setForm({ ...form, address: { ...form.address, country: sanitizePlaceName(e.target.value) } })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Zip</label>
              <Input
                inputMode="numeric"
                value={form.address.zip}
                onChange={(e) => setForm({
                  ...form,
                  address: { ...form.address, zip: e.target.value.replace(/\D/g, "") }
                })}
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-slate-900">KYC Documents</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 p-3">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Address Proof (optional)</label>
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                aria-label="Choose address proof file"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (!validateFile(file, PROOF_TYPES, PROOF_MAX_BYTES, "Address proof")) return;
                  const base64Data = await fileToBase64(file);
                  setForm({
                    ...form,
                    addressProofUpload: {
                      fileName: file.name,
                      mimeType: file.type,
                      base64Data
                    }
                  });
                }}
              />
              <p className="mt-2 text-xs text-slate-500">Choose address proof file (PDF, JPG, PNG, WEBP up to 5MB)</p>
              {form.addressProofUpload?.fileName && (
                <p className="mt-2 text-xs text-slate-600">{form.addressProofUpload.fileName}</p>
              )}
              {!form.addressProofUpload?.fileName && profile?.addressProof?.fileName && (
                <p className="mt-2 text-xs text-slate-600">Current: {profile.addressProof.fileName}</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Aadhaar Card (optional)</label>
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                aria-label="Choose Aadhaar proof file"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (!validateFile(file, PROOF_TYPES, PROOF_MAX_BYTES, "Aadhaar proof")) return;
                  const base64Data = await fileToBase64(file);
                  setForm({
                    ...form,
                    aadhaarProofUpload: {
                      fileName: file.name,
                      mimeType: file.type,
                      base64Data
                    }
                  });
                }}
              />
              <p className="mt-2 text-xs text-slate-500">Choose Aadhaar proof file (PDF, JPG, PNG, WEBP up to 5MB)</p>
              {form.aadhaarProofUpload?.fileName && (
                <p className="mt-2 text-xs text-slate-600">{form.aadhaarProofUpload.fileName}</p>
              )}
              {!form.aadhaarProofUpload?.fileName && profile?.aadhaarProof?.fileName && (
                <p className="mt-2 text-xs text-slate-600">Current: {profile.aadhaarProof.fileName}</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">PAN Card (optional)</label>
              <Input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                aria-label="Choose PAN proof file"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (!validateFile(file, PROOF_TYPES, PROOF_MAX_BYTES, "PAN proof")) return;
                  const base64Data = await fileToBase64(file);
                  setForm({
                    ...form,
                    panProofUpload: {
                      fileName: file.name,
                      mimeType: file.type,
                      base64Data
                    }
                  });
                }}
              />
              <p className="mt-2 text-xs text-slate-500">Choose PAN proof file (PDF, JPG, PNG, WEBP up to 5MB)</p>
              {form.panProofUpload?.fileName && (
                <p className="mt-2 text-xs text-slate-600">{form.panProofUpload.fileName}</p>
              )}
              {!form.panProofUpload?.fileName && profile?.panProof?.fileName && (
                <p className="mt-2 text-xs text-slate-600">Current: {profile.panProof.fileName}</p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-slate-900">Emergency Contact (optional)</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input
              placeholder="Name"
              validationType="name"
              value={form.emergencyContacts[0].name}
              onChange={(e) =>
                setForm({
                  ...form,
                  emergencyContacts: [{ ...form.emergencyContacts[0], name: e.target.value }]
                })
              }
            />
            <Select
              value={form.emergencyContacts[0].relation || ""}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  emergencyContacts: [{ ...form.emergencyContacts[0], relation: value }]
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Relationship" />
              </SelectTrigger>
              <SelectContent>
                {RELATION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Mobile Number"
              validationType="phone"
              inputMode="numeric"
              maxLength={10}
              value={form.emergencyContacts[0].phone}
              onChange={(e) =>
                setForm({
                  ...form,
                  emergencyContacts: [{ ...form.emergencyContacts[0], phone: e.target.value }]
                })
              }
            />
          </div>
        </section>

        <div className="flex items-center justify-end pb-2">
          <Button onClick={handleSubmit} disabled={loading} className="h-11 px-7">
            {loading ? "Saving..." : "Save and Continue"}
          </Button>
        </div>
      </div>
    </MainLayout>
  );
};

export default CompleteProfile;
