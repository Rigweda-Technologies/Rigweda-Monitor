import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { createMonitorRelease, getMonitorReleases, updateMonitorRelease, type MonitorRelease } from "@/services/monitorRelease";

const emptyForm = {
  version: "",
  build: "",
  fileBase64: "",
  fileName: "",
  mandatory: false,
  rolloutPercentage: 100,
  status: "draft" as MonitorRelease["status"]
};

export default function MonitorUpdates() {
  const [releases, setReleases] = useState<MonitorRelease[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedFileLabel, setSelectedFileLabel] = useState("");

  const latest = useMemo(() => releases[0], [releases]);

  const refresh = async () => {
    setLoading(true);
    try {
      setReleases(await getMonitorReleases());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load releases.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const handleCreate = async () => {
    try {
      setSaving(true);
      if (!form.fileBase64.trim()) {
        throw new Error("Select an EXE file before creating the release.");
      }
      await createMonitorRelease({
        version: form.version.trim(),
        build: Number.parseInt(form.build, 10),
        fileBase64: form.fileBase64.trim(),
        fileName: form.fileName.trim() || `RigwedaMonitor-${form.version.trim()}.exe`,
        mandatory: form.mandatory,
        rolloutPercentage: form.rolloutPercentage,
        status: form.status
      });
      toast.success("Release created");
      setForm(emptyForm);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create release.");
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelectedFileLabel("");
      setForm((prev) => ({ ...prev, fileBase64: "", fileName: "" }));
      return;
    }

    const base64 = await fileToBase64(file);
    setSelectedFileLabel(`${file.name} (${Math.round(file.size / 1024)} KB)`);
    setForm((prev) => ({
      ...prev,
      fileBase64: base64,
      fileName: prev.fileName.trim() || file.name
    }));
  };

  const handleActivate = async (releaseId: string, status: MonitorRelease["status"]) => {
    try {
      await updateMonitorRelease(releaseId, { status });
      toast.success(`Release ${status}`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update release.");
    }
  };

  return (
    <MainLayout title="Monitor Updates" breadcrumb={[{ label: "Home", href: "/" }, { label: "Employee Monitor" }, { label: "Updates" }]}>
      <div className="mx-auto max-w-6xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Release management</CardTitle>
            <CardDescription>Upload a signed EXE, set rollout, and activate the release.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Version</Label>
              <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Build number</Label>
              <Input value={form.build} onChange={(e) => setForm({ ...form, build: e.target.value })} />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>File name</Label>
              <Input value={form.fileName} onChange={(e) => setForm({ ...form, fileName: e.target.value })} />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="exeFile">Release EXE</Label>
              <Input id="exeFile" type="file" accept=".exe" onChange={handleFileChange} />
              <p className="text-xs text-muted-foreground">
                {selectedFileLabel || "Choose the signed RigwedaMonitor EXE to upload to R2."}
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Rollout %</Label>
              <Input type="number" min={0} max={100} value={form.rolloutPercentage} onChange={(e) => setForm({ ...form, rolloutPercentage: Number(e.target.value) })} />
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value as MonitorRelease["status"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="testing">Testing</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <input id="mandatory" type="checkbox" checked={form.mandatory} onChange={(e) => setForm({ ...form, mandatory: e.target.checked })} />
              <Label htmlFor="mandatory">Mandatory update</Label>
            </div>
            <Button onClick={handleCreate} disabled={saving || !form.version || !form.build || !form.fileBase64}>
              {saving ? "Saving..." : "Create release"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Releases</CardTitle>
            <CardDescription>Latest release: {latest?.version || "none"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? <div>Loading...</div> : releases.map((release) => (
              <div key={release._id} className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-semibold">{release.version} <Badge variant="secondary">{release.status}</Badge></div>
                  <div className="text-sm text-muted-foreground">Build {release.build} • Rollout {release.rolloutPercentage}% • {release.sha256.slice(0, 12)}...</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => handleActivate(release._id, "testing")}>Testing</Button>
                  <Button variant="outline" onClick={() => handleActivate(release._id, "active")}>Activate</Button>
                  <Button variant="destructive" onClick={() => handleActivate(release._id, "disabled")}>Disable</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Could not read the selected EXE file."));
    reader.readAsDataURL(file);
  });
}
