import { useEffect, useState } from "react";
import { RefreshCw, Save, ShieldCheck } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getMonitorCloudinarySettings,
  saveMonitorCloudinarySettings,
  testMonitorCloudinarySettings
} from "@/services/monitorActivity";
import { toast } from "sonner";

const MonitorSettings = () => {
  const [form, setForm] = useState({
    cloudName: "",
    apiKey: "",
    apiSecret: "",
    apiSecretMasked: "",
    uploadFolderRoot: "rigweda-monitor"
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const settings = await getMonitorCloudinarySettings();
        if (settings) {
          setForm({
            cloudName: settings.cloudName || "",
            apiKey: settings.apiKey || "",
            apiSecret: "",
            apiSecretMasked: settings.apiSecretMasked || "",
            uploadFolderRoot: settings.uploadFolderRoot || "rigweda-monitor"
          });
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load monitor settings.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const buildPayload = () => ({
    cloudName: form.cloudName.trim(),
    apiKey: form.apiKey.trim(),
    apiSecret: form.apiSecret.trim(),
    uploadFolderRoot: form.uploadFolderRoot.trim() || "rigweda-monitor"
  });

  const handleTest = async () => {
    try {
      setTesting(true);
      await testMonitorCloudinarySettings(buildPayload());
      toast.success("Cloudinary connection verified");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not verify Cloudinary settings.");
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const settings = await saveMonitorCloudinarySettings(buildPayload());
      setForm((prev) => ({
        ...prev,
        apiSecret: "",
        apiSecretMasked: settings.apiSecretMasked || prev.apiSecretMasked
      }));
      toast.success("Monitor settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save monitor settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <MainLayout title="Monitor Settings" breadcrumb={[{ label: "Home", href: "/" }, { label: "Employee Monitor" }, { label: "Settings" }]}>
      <div className="max-w-3xl space-y-6">
        <div>
          <h2 className="text-2xl font-semibold">Cloudinary settings</h2>
          <p className="text-sm text-muted-foreground">
            These credentials are used by the monitor backend to sign screenshot uploads and fetch Cloudinary screenshots.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              Upload storage
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="cloudName">Cloud name</Label>
              <Input id="cloudName" value={form.cloudName} disabled={loading} onChange={(event) => setForm({ ...form, cloudName: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apiKey">API key</Label>
              <Input id="apiKey" value={form.apiKey} disabled={loading} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="apiSecret">API secret</Label>
              <Input
                id="apiSecret"
                type="password"
                value={form.apiSecret}
                placeholder={form.apiSecretMasked || "Enter API secret"}
                disabled={loading}
                onChange={(event) => setForm({ ...form, apiSecret: event.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="uploadFolderRoot">Folder root</Label>
              <Input id="uploadFolderRoot" value={form.uploadFolderRoot} disabled={loading} onChange={(event) => setForm({ ...form, uploadFolderRoot: event.target.value })} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={handleTest} disabled={loading || testing || !form.apiSecret.trim()}>
                <RefreshCw className={`mr-2 h-4 w-4 ${testing ? "animate-spin" : ""}`} />
                Test
              </Button>
              <Button onClick={handleSave} disabled={loading || saving || !form.apiSecret.trim()}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : "Save settings"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default MonitorSettings;
