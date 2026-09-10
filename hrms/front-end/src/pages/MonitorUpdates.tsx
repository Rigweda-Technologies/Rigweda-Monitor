import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Download, Upload, X } from "lucide-react";
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
  const [uploadOpen, setUploadOpen] = useState(false);

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

  const handleDownload = (release: MonitorRelease) => {
    if (!release.signedDownloadUrl) {
      toast.error("This release does not have a downloadable file.");
      return;
    }

    const link = document.createElement("a");
    link.href = release.signedDownloadUrl;
    link.download = `RigwedaMonitor-${release.version}.exe`;
    link.target = "_blank";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <MainLayout title="Monitor Updates" breadcrumb={[{ label: "Home", href: "/" }, { label: "Monitor" }, { label: "Updates" }]}>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-600">Monitor</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Releases</h1>
            <p className="mt-1 text-sm text-slate-500">Manage desktop builds, rollout status, and monitor updates.</p>
          </div>
          <Button onClick={() => setUploadOpen((open) => !open)} className="shrink-0 gap-2">
            {uploadOpen ? <X size={16} /> : <Upload size={16} />}
            {uploadOpen ? "Close upload" : "Upload latest build"}
          </Button>
        </div>

        {uploadOpen && <Card className="border-emerald-100 shadow-sm">
          <CardHeader>
            <CardTitle>Upload latest build</CardTitle>
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
        </Card>}

        <Card>
          <CardHeader>
            <CardTitle>Releases</CardTitle>
            <CardDescription>Latest release: {latest?.version || "none"}</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? <div className="px-6 py-10 text-sm text-slate-500">Loading releases...</div> : releases.length === 0 ? <div className="px-6 py-10 text-sm text-slate-500">No releases have been uploaded yet.</div> : <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Build</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rollout</TableHead>
                  <TableHead>Checksum</TableHead>
                  <TableHead>Released</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {releases.map((release) => <TableRow key={release._id}>
                  <TableCell className="whitespace-nowrap font-semibold">{release.version}</TableCell>
                  <TableCell className="whitespace-nowrap">Build {release.build}</TableCell>
                  <TableCell><Badge variant={release.status === "active" ? "default" : release.status === "disabled" ? "destructive" : "secondary"}>{release.status}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap">{release.rolloutPercentage}%</TableCell>
                  <TableCell className="font-mono text-xs text-slate-500">{release.sha256.slice(0, 12)}...</TableCell>
                  <TableCell className="whitespace-nowrap text-slate-500">{release.releasedAt ? new Date(release.releasedAt).toLocaleDateString() : "Not released"}</TableCell>
                  <TableCell><div className="flex justify-end gap-2 whitespace-nowrap">
                    <Button size="sm" variant="outline" disabled={!release.signedDownloadUrl} title={release.signedDownloadUrl ? "Download build" : "No download available"} onClick={() => handleDownload(release)}><Download size={14} />Download</Button>
                    <Button size="sm" variant="outline" onClick={() => handleActivate(release._id, "testing")}>Testing</Button>
                    <Button size="sm" variant="outline" onClick={() => handleActivate(release._id, "active")}>Activate</Button>
                    <Button size="sm" variant="destructive" onClick={() => handleActivate(release._id, "disabled")}>Disable</Button>
                  </div></TableCell>
                </TableRow>)}
              </TableBody>
            </Table>}
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
