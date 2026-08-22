import { useEffect, useState } from "react";
import {
  AlertCircle,
  Camera,
  CloudCog,
  FolderTree,
  Globe,
  Keyboard,
  Monitor,
  MousePointer2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  CheckCircle2,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  getMonitorCloudinarySettings,
  saveMonitorCloudinarySettings,
  testMonitorCloudinarySettings
} from "@/services/monitorActivity";
import { toast } from "sonner";

type MonitorControlKey = "screenshotsEnabled" | "mouseEnabled" | "keyboardEnabled" | "appUsageEnabled" | "browserHistoryEnabled";
type MonitorNumericKey =
  | "screenshotIntervalMinutes"
  | "mouseHeartbeatMinutes"
  | "mouseIdleThresholdMinutes"
  | "keyboardHeartbeatMinutes"
  | "appUsageHeartbeatMinutes"
  | "browserHistorySyncMinutes";

type MonitorSettingsForm = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  apiSecretMasked: string;
  uploadFolderRoot: string;
  screenshotsEnabled: boolean;
  mouseEnabled: boolean;
  keyboardEnabled: boolean;
  appUsageEnabled: boolean;
  browserHistoryEnabled: boolean;
  screenshotIntervalMinutes: number;
  mouseHeartbeatMinutes: number;
  mouseIdleThresholdMinutes: number;
  keyboardHeartbeatMinutes: number;
  appUsageHeartbeatMinutes: number;
  browserHistorySyncMinutes: number;
};

const MONITOR_CONTROLS: Array<{
  key: MonitorControlKey;
  label: string;
  description: string;
}> = [
  {
    key: "screenshotsEnabled",
    label: "Screenshots",
    description: "Capture and upload employee screenshots.",
  },
  {
    key: "mouseEnabled",
    label: "Mouse activity",
    description: "Track idle and active mouse movement.",
  },
  {
    key: "keyboardEnabled",
    label: "Keyboard activity",
    description: "Track app-scoped key usage sessions.",
  },
  {
    key: "appUsageEnabled",
    label: "App usage",
    description: "Track foreground application usage sessions.",
  },
  {
    key: "browserHistoryEnabled",
    label: "Browser history",
    description: "Record approved browser navigation activity.",
  },
];

const MONITOR_SECTIONS: Array<{
  key: MonitorControlKey;
  label: string;
  description: string;
  icon: typeof Camera;
  fields: Array<{
    key: MonitorNumericKey;
    label: string;
    helper: string;
    fullWidth?: boolean;
  }>;
}> = [
  {
    key: "screenshotsEnabled",
    label: "Screenshots",
    description: "Capture and upload employee screenshots.",
    icon: Camera,
    fields: [
      {
        key: "screenshotIntervalMinutes",
        label: "Interval",
        helper: "Capture one screenshot every N minutes.",
      },
    ],
  },
  {
    key: "mouseEnabled",
    label: "Mouse activity",
    description: "Track idle and active mouse movement.",
    icon: MousePointer2,
    fields: [
      {
        key: "mouseHeartbeatMinutes",
        label: "Heartbeat",
        helper: "Send a mouse activity heartbeat every N minutes.",
      },
      {
        key: "mouseIdleThresholdMinutes",
        label: "Idle threshold",
        helper: "If the mouse stays active for N minutes, keep the user online for the next N minutes.",
      },
    ],
  },
  {
    key: "keyboardEnabled",
    label: "Keyboard activity",
    description: "Track app-scoped key usage sessions.",
    icon: Keyboard,
    fields: [
      {
        key: "keyboardHeartbeatMinutes",
        label: "Sync interval",
        helper: "Sync keyboard sessions every N minutes.",
      },
    ],
  },
  {
    key: "appUsageEnabled",
    label: "App usage",
    description: "Track foreground application usage sessions.",
    icon: Monitor,
    fields: [
      {
        key: "appUsageHeartbeatMinutes",
        label: "Sync interval",
        helper: "Send foreground app sessions every N minutes.",
      },
    ],
  },
  {
    key: "browserHistoryEnabled",
    label: "Browser history",
    description: "Record approved browser navigation activity.",
    icon: Globe,
    fields: [
      {
        key: "browserHistorySyncMinutes",
        label: "Sync interval",
        helper: "Sync browser history every N minutes.",
      },
    ],
  },
];

const MonitorSettings = () => {
  const [form, setForm] = useState<MonitorSettingsForm>({
    cloudName: "",
    apiKey: "",
    apiSecret: "",
    apiSecretMasked: "",
    uploadFolderRoot: "rigweda-monitor",
    screenshotsEnabled: true,
    mouseEnabled: true,
    keyboardEnabled: true,
    appUsageEnabled: true,
    browserHistoryEnabled: false,
    screenshotIntervalMinutes: 1,
    mouseHeartbeatMinutes: 1,
    mouseIdleThresholdMinutes: 1,
    keyboardHeartbeatMinutes: 1,
    appUsageHeartbeatMinutes: 1,
    browserHistorySyncMinutes: 1
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const hasSecret = Boolean(form.apiSecret.trim() || form.apiSecretMasked);
  const enabledCount = [form.screenshotsEnabled, form.mouseEnabled, form.keyboardEnabled, form.appUsageEnabled, form.browserHistoryEnabled].filter(Boolean).length;
  const totalControls = MONITOR_CONTROLS.length;

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
            uploadFolderRoot: settings.uploadFolderRoot || "rigweda-monitor",
            screenshotsEnabled: settings.screenshotsEnabled ?? true,
            mouseEnabled: settings.mouseEnabled ?? true,
            keyboardEnabled: settings.keyboardEnabled ?? true,
            appUsageEnabled: settings.appUsageEnabled ?? true,
            browserHistoryEnabled: settings.browserHistoryEnabled ?? false,
            screenshotIntervalMinutes: Math.max(Number(settings.screenshotIntervalMinutes || 1), 1),
            mouseHeartbeatMinutes: Math.max(Number(settings.mouseHeartbeatMinutes || 1), 1),
            mouseIdleThresholdMinutes: Math.max(Number(settings.mouseIdleThresholdMinutes || 1), 1),
            keyboardHeartbeatMinutes: Math.max(Number(settings.keyboardHeartbeatMinutes || 1), 1),
            appUsageHeartbeatMinutes: Math.max(Number(settings.appUsageHeartbeatMinutes || 1), 1),
            browserHistorySyncMinutes: Math.max(Number(settings.browserHistorySyncMinutes || 1), 1)
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
    uploadFolderRoot: form.uploadFolderRoot.trim() || "rigweda-monitor",
    screenshotsEnabled: form.screenshotsEnabled,
    mouseEnabled: form.mouseEnabled,
    keyboardEnabled: form.keyboardEnabled,
    appUsageEnabled: form.appUsageEnabled,
    browserHistoryEnabled: form.browserHistoryEnabled,
    screenshotIntervalMinutes: form.screenshotIntervalMinutes,
    mouseHeartbeatMinutes: form.mouseHeartbeatMinutes,
    mouseIdleThresholdMinutes: form.mouseIdleThresholdMinutes,
    keyboardHeartbeatMinutes: form.keyboardHeartbeatMinutes,
    appUsageHeartbeatMinutes: form.appUsageHeartbeatMinutes,
    browserHistorySyncMinutes: form.browserHistorySyncMinutes
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
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="relative overflow-hidden rounded-3xl border border-slate-200/70 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-6 py-8 text-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.55)] md:px-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.14),transparent_36%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.22),transparent_28%)]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" />
                Employee Monitor configuration
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Cloudinary settings and capture controls</h2>
                <p className="max-w-xl text-sm leading-6 text-white/75 md:text-base">
                  Manage upload credentials, folder structure, and which monitor signals the desktop client is allowed to run.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4 backdrop-blur sm:max-w-sm">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-white/55">
                <CheckCircle2 className="h-4 w-4" />
                Monitor status
              </div>
              <div className="mt-2 text-lg font-semibold">{enabledCount} of {totalControls} signals enabled</div>
              <p className="mt-1 text-sm text-white/70">
                Screenshot, mouse, keyboard, and browser-history permissions are controlled from this page.
              </p>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
          <div className="space-y-6">
            <Card className="overflow-hidden border-slate-200/80 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  Connection details
                </CardTitle>
                <CardDescription>
                  These settings let the monitor backend upload screenshots to Cloudinary.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 pt-6">
                <div className="grid gap-2">
                  <Label htmlFor="cloudName" className="flex items-center gap-2">
                    <CloudCog className="h-4 w-4 text-muted-foreground" />
                    Cloud name
                  </Label>
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
                  <p className="text-xs text-muted-foreground">
                    Leave this blank to keep the saved secret when you only change toggles or the folder path.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="uploadFolderRoot" className="flex items-center gap-2">
                    <FolderTree className="h-4 w-4 text-muted-foreground" />
                    Folder root
                  </Label>
                  <Input
                    id="uploadFolderRoot"
                    value={form.uploadFolderRoot}
                    disabled={loading}
                    onChange={(event) => setForm({ ...form, uploadFolderRoot: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                  <Button variant="outline" onClick={handleTest} disabled={loading || testing || !form.apiSecret.trim()}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${testing ? "animate-spin" : ""}`} />
                    {testing ? "Testing..." : "Test Cloudinary"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-slate-200/80 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <SlidersHorizontal className="h-5 w-5 text-primary" />
                  Monitor controls
                </CardTitle>
                <CardDescription>
                  Turn individual employee monitoring signals on or off for the desktop client.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div className="grid gap-4 xl:grid-cols-2">
                  {MONITOR_SECTIONS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.key}
                        className="rounded-2xl border border-slate-200/70 bg-gradient-to-br from-background to-muted/20 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3">
                            <div className="rounded-xl bg-primary/10 p-2 text-primary">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={item.key} className="text-sm font-semibold">
                                {item.label}
                              </Label>
                              <p className="max-w-md text-xs text-muted-foreground">{item.description}</p>
                            </div>
                          </div>
                          <Switch
                            id={item.key}
                            checked={form[item.key]}
                            disabled={loading}
                            onCheckedChange={(checked) =>
                              setForm((prev) => ({
                                ...prev,
                                [item.key]: checked,
                              }))
                            }
                          />
                        </div>

                        <div className={`mt-4 grid gap-3 ${item.fields.length > 1 ? "md:grid-cols-2" : ""}`}>
                          {item.fields.map((field) => (
                            <div key={field.key} className={`grid gap-2 ${field.fullWidth ? "md:col-span-2" : ""}`}>
                              <Label htmlFor={field.key} className="text-xs font-medium text-foreground">
                                {field.label}
                              </Label>
                              <Input
                                id={field.key}
                                type="number"
                                min={1}
                                step={1}
                                value={form[field.key]}
                                disabled={loading || !form[item.key]}
                                onChange={(event) =>
                                  setForm((prev) => ({
                                    ...prev,
                                    [field.key]: Math.max(Number(event.target.value || 1), 1),
                                  }))
                                }
                              />
                              <p className="text-xs leading-5 text-muted-foreground">{field.helper}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-slate-200/80 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
              <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    Ready to apply changes
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Save updates to keep the desktop client and upload pipeline aligned.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={handleSave} disabled={loading || saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Saving..." : "Save settings"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="sticky top-6 overflow-hidden border-slate-200/80 shadow-sm">
              <CardHeader className="border-b bg-muted/20">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  Live summary
                </CardTitle>
                <CardDescription>Quick view of the current monitor posture.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-6">
                <div className="rounded-2xl border bg-background p-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Cloud secret</div>
                  <div className="mt-2 text-sm font-medium">{hasSecret ? "Configured" : "Missing"}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {form.apiSecretMasked || form.apiSecret.trim() ? "A saved secret is already available." : "Enter a secret before testing or saving a new config."}
                  </p>
                </div>

                <div className="grid gap-3">
                  {[
                    {
                      label: "Screenshots",
                      enabled: form.screenshotsEnabled,
                      helper: `Image uploads every ${form.screenshotIntervalMinutes} minute(s).`,
                    },
                    {
                      label: "Mouse activity",
                      enabled: form.mouseEnabled,
                      helper: `Heartbeat every ${form.mouseHeartbeatMinutes} minute(s); idle threshold ${form.mouseIdleThresholdMinutes} minute(s).`,
                    },
                    {
                      label: "Keyboard activity",
                      enabled: form.keyboardEnabled,
                      helper: `Sync every ${form.keyboardHeartbeatMinutes} minute(s).`,
                    },
                    {
                      label: "App usage",
                      enabled: form.appUsageEnabled,
                      helper: `Sync every ${form.appUsageHeartbeatMinutes} minute(s).`,
                    },
                    {
                      label: "Browser history",
                      enabled: form.browserHistoryEnabled,
                      helper: `Sync every ${form.browserHistorySyncMinutes} minute(s).`,
                    },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between rounded-2xl border bg-muted/20 px-4 py-3">
                      <div>
                        <div className="text-sm font-medium">{item.label}</div>
                        <div className="text-xs text-muted-foreground">{item.helper}</div>
                      </div>
                      <CheckCircle2 className={`h-4 w-4 ${item.enabled ? "text-emerald-500" : "text-rose-500"}`} />
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertCircle className="h-4 w-4" />
                    Tip
                  </div>
                  <p className="mt-2 text-xs leading-5 text-amber-800">
                    Save the current config after changing a switch so the desktop client can pick up the new flag set.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default MonitorSettings;
