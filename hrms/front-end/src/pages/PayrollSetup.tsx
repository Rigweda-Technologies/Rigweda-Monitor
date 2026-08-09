import { useCallback, useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { deleteApiWithToken, getApiWithToken, postApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { hasAnyPermission } from "@/utils/auth";
import { toast } from "sonner";
import { PayrollSetupWizard } from "@/components/payroll/PayrollSetupWizard";
import PayrollSectionNav from "@/components/payroll/PayrollSectionNav";
import { emptyPayGroupForm, type PayGroup, type PayGroupForm } from "@/components/payroll/payrollShared";

const LAST_SELECTED_PAY_GROUP_KEY = "payroll:last-selected-pay-group-id";

const PayrollSetup = () => {
  const canManageConfig = hasAnyPermission(["PAYROLL_CONFIG_MANAGE"]);
  const [settings, setSettings] = useState<any>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [payGroups, setPayGroups] = useState<PayGroup[]>([]);
  const [selectedPayGroupId, setSelectedPayGroupId] = useState(() =>
    localStorage.getItem(LAST_SELECTED_PAY_GROUP_KEY) || ""
  );
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardPayGroupId, setWizardPayGroupId] = useState("");
  const [payGroupDialogOpen, setPayGroupDialogOpen] = useState(false);
  const [payGroupForm, setPayGroupForm] = useState<PayGroupForm>(emptyPayGroupForm);
  const [editingPayGroupId, setEditingPayGroupId] = useState("");
  const [payGroupSaving, setPayGroupSaving] = useState(false);

  const selectedPayGroup = useMemo(
    () => payGroups.find((group) => group.id === selectedPayGroupId) || null,
    [payGroups, selectedPayGroupId]
  );

  const loadSettings = async () => {
    const res = await getApiWithToken("/payroll/settings");
    if (res?.success) {
      setSettings(res.data || null);
    }
    setSettingsLoaded(true);
  };

  const loadPayGroups = useCallback(async () => {
    if (!canManageConfig) return;
    const res = await getApiWithToken("/payroll/pay-groups?includeInactive=true", null, {
      requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
    });
    if (res?.success) {
      const rows = Array.isArray(res.data) ? res.data : [];
      setPayGroups(rows);
    } else if (!res?.skipped) {
      toast.error(res?.message || "Failed to load pay groups");
    }
  }, [canManageConfig]);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    if (!settingsLoaded || settings?.payrollEnabled === false) {
      setPayGroups([]);
      return;
    }
    loadPayGroups();
  }, [loadPayGroups, settingsLoaded, settings?.payrollEnabled]);

  useEffect(() => {
    if (!payGroups.length) return;
    if (selectedPayGroupId && payGroups.some((group) => group.id === selectedPayGroupId)) return;
    const storedPayGroupId = localStorage.getItem(LAST_SELECTED_PAY_GROUP_KEY) || "";
    if (storedPayGroupId && payGroups.some((group) => group.id === storedPayGroupId)) {
      setSelectedPayGroupId(storedPayGroupId);
      return;
    }
    const preferredPayGroupId =
      settings?.default_pay_group_id ||
      settings?.defaultPayGroupId ||
      payGroups.find((group) => group.is_active)?.id ||
      payGroups[0]?.id ||
      "";
    const nextSelectedPayGroupId = String(preferredPayGroupId || "");
    setSelectedPayGroupId(nextSelectedPayGroupId);
    if (nextSelectedPayGroupId) {
      localStorage.setItem(LAST_SELECTED_PAY_GROUP_KEY, nextSelectedPayGroupId);
    }
  }, [payGroups, selectedPayGroupId, settings?.defaultPayGroupId, settings?.default_pay_group_id]);

  const openCreatePayGroup = () => {
    setEditingPayGroupId("");
    setPayGroupForm({
      ...emptyPayGroupForm,
      salaryPayDay: String(Number(settings?.payrollSalaryPayDay || 30))
    });
    setPayGroupDialogOpen(true);
  };

  const openEditPayGroup = (group: PayGroup) => {
    const basicPercent =
      group?.metadata?.salaryRules?.basicPercent ??
      group?.metadata?.basicPercent ??
      50;
    setEditingPayGroupId(group.id);
    setPayGroupForm({
      code: group.code || "",
      name: group.name || "",
      description: group.description || "",
      payFrequency: group.pay_frequency || "monthly",
      salaryPayDay: String(group.salary_pay_day || 30),
      workWeekDays: String(group.work_week_days || 6),
      basicPercent: String(basicPercent)
    });
    setPayGroupDialogOpen(true);
  };

  const openSetupWizardForPayGroup = (payGroupId: string) => {
    setSelectedPayGroupId(payGroupId);
    localStorage.setItem(LAST_SELECTED_PAY_GROUP_KEY, payGroupId);
    setWizardPayGroupId(payGroupId);
    setWizardOpen(true);
  };

  const savePayGroup = async () => {
    if (!payGroupForm.code.trim() || !payGroupForm.name.trim()) {
      toast.error("Code and Name are required");
      return;
    }

    const payload = {
      code: payGroupForm.code.trim().toUpperCase(),
      name: payGroupForm.name.trim(),
      description: payGroupForm.description.trim() || null,
      payFrequency: payGroupForm.payFrequency,
      salaryPayDay: Number(payGroupForm.salaryPayDay || 30),
      workWeekDays: Number(payGroupForm.workWeekDays || 6),
      metadata: {
        salaryRules: {
          basicPercent: Number(payGroupForm.basicPercent || 50)
        }
      }
    };

    setPayGroupSaving(true);
    try {
      const res = editingPayGroupId
        ? await putApiWithToken(`/payroll/pay-groups/${editingPayGroupId}`, payload, null, {
            requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
          })
        : await postApiWithToken("/payroll/pay-groups", payload, null, {
            requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
          });

      if (!res?.success) {
        toast.error(res?.message || "Failed to save pay group");
        return;
      }

      const savedPayGroupId = String(res?.data?.id || editingPayGroupId || "");
      toast.success(editingPayGroupId ? "Pay group updated" : "Pay group created");
      setPayGroupDialogOpen(false);
      await loadPayGroups();
      if (savedPayGroupId) {
        setSelectedPayGroupId(savedPayGroupId);
        localStorage.setItem(LAST_SELECTED_PAY_GROUP_KEY, savedPayGroupId);
      }
      if (!editingPayGroupId && savedPayGroupId) {
        openSetupWizardForPayGroup(savedPayGroupId);
      }
    } finally {
      setPayGroupSaving(false);
    }
  };

  const archivePayGroup = async (group: PayGroup) => {
    const confirmed = window.confirm(`Archive pay group "${group.name}"?`);
    if (!confirmed) return;

    const res = await deleteApiWithToken(`/payroll/pay-groups/${group.id}`);
    if (!res?.success) {
      toast.error(res?.message || "Failed to archive pay group");
      return;
    }
    toast.success("Pay group archived");
    await loadPayGroups();
  };

  const activatePayGroup = async (group: PayGroup) => {
    const confirmed = window.confirm(`Activate pay group "${group.name}" again?`);
    if (!confirmed) return;

    const res = await putApiWithToken(`/payroll/pay-groups/${group.id}`, { isActive: true }, null, {
      requiredPermissions: ["PAYROLL_CONFIG_MANAGE"]
    });
    if (!res?.success) {
      toast.error(res?.message || "Failed to activate pay group");
      return;
    }
    toast.success("Pay group activated");
    await loadPayGroups();
    setSelectedPayGroupId(group.id);
    localStorage.setItem(LAST_SELECTED_PAY_GROUP_KEY, group.id);
  };

  return (
    <MainLayout
      title="Payroll Setup"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Payroll" }, { label: "Setup" }]}
    >
      <PayrollSectionNav />

      {settingsLoaded && settings?.payrollEnabled === false && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Payroll is disabled for this organization. Enable it from Organization Settings first.
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 shadow-sm xl:col-span-2">
          <p className="text-lg font-semibold">Setup Flow</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with one pay group, load components through the setup wizard, then move to the
            Employees screen to assign the pay group and customize salary employee by employee.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="rounded-xl border p-3">
              <p className="text-xs font-medium text-muted-foreground">Step 1</p>
              <p className="mt-1 font-medium">Create Pay Group</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs font-medium text-muted-foreground">Step 2</p>
              <p className="mt-1 font-medium">Setup Components</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs font-medium text-muted-foreground">Step 3</p>
              <p className="mt-1 font-medium">Assign Employees</p>
            </div>
            <div className="rounded-xl border p-3">
              <p className="text-xs font-medium text-muted-foreground">Step 4</p>
              <p className="mt-1 font-medium">Run Payroll</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <p className="font-semibold">Selected Pay Group</p>
          {selectedPayGroup ? (
            <div className="mt-3 space-y-2 text-sm">
              <p className="font-medium">{selectedPayGroup.name}</p>
              <p className="text-muted-foreground">{selectedPayGroup.code}</p>
              <p className="text-muted-foreground">
                Frequency: {selectedPayGroup.pay_frequency} | Pay day: {selectedPayGroup.salary_pay_day}
              </p>
              <div className="pt-2">
                {selectedPayGroup.is_active ? (
                  <Badge className="bg-green-600 text-white">Active</Badge>
                ) : (
                  <Badge variant="secondary">Archived</Badge>
                )}
              </div>
              <div className="pt-3 flex gap-2">
                <Button size="sm" onClick={() => openSetupWizardForPayGroup(selectedPayGroup.id)}>
                  Setup Components
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEditPayGroup(selectedPayGroup)}>
                  Edit Group
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Create a pay group to begin payroll setup.</p>
          )}
        </div>
      </div>

      {canManageConfig && settings?.payrollEnabled !== false && (
        <div className="rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b p-4">
            <div>
              <p className="font-semibold">Pay Groups</p>
              <p className="text-sm text-muted-foreground">
                Configure salary cycles here before moving to employee assignment.
              </p>
            </div>
            <Button size="sm" onClick={openCreatePayGroup}>
              Add Pay Group
            </Button>
          </div>
          <div className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead className="text-right">Basic %</TableHead>
                  <TableHead className="text-right">Cutoff</TableHead>
                  <TableHead className="text-right">Pay Day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payGroups.map((group) => (
                  <TableRow
                    key={group.id}
                    className={selectedPayGroupId === group.id ? "bg-muted/40" : ""}
                    onClick={() => setSelectedPayGroupId(group.id)}
                  >
                    <TableCell className="font-medium">{group.code}</TableCell>
                    <TableCell>{group.name}</TableCell>
                    <TableCell>{group.pay_frequency}</TableCell>
                    <TableCell className="text-right">
                      {group?.metadata?.salaryRules?.basicPercent ??
                        group?.metadata?.basicPercent ??
                        50}
                    </TableCell>
                    <TableCell className="text-right">{group.cutoff_day || "-"}</TableCell>
                    <TableCell className="text-right">{group.salary_pay_day}</TableCell>
                    <TableCell>
                      {group.is_active ? (
                        <Badge className="bg-green-600 text-white">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Archived</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          openSetupWizardForPayGroup(group.id);
                        }}
                      >
                        Setup Wizard
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditPayGroup(group);
                        }}
                      >
                        Edit
                      </Button>
                      {group.is_active ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            archivePayGroup(group);
                          }}
                        >
                          Archive
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            activatePayGroup(group);
                          }}
                        >
                          Activate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!payGroups.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      No pay groups found. Click "Add Pay Group" to create one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <PayrollSetupWizard
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) setWizardPayGroupId("");
        }}
        initialSettings={settings}
        preferredPayGroupId={wizardPayGroupId}
        payrollCutoffDay={Number(settings?.payrollCutoffDay || 25)}
        payrollSalaryPayDay={Number(settings?.payrollSalaryPayDay || 30)}
        onActivated={() => {
          loadSettings();
          loadPayGroups();
        }}
      />

      <Dialog open={payGroupDialogOpen} onOpenChange={setPayGroupDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingPayGroupId ? "Edit Pay Group" : "Add Pay Group"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Code</label>
              <Input
                value={payGroupForm.code}
                onChange={(e) =>
                  setPayGroupForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">Name</label>
              <Input
                value={payGroupForm.name}
                onChange={(e) => setPayGroupForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={payGroupForm.description}
                onChange={(e) =>
                  setPayGroupForm((prev) => ({ ...prev, description: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">Pay Frequency</label>
              <Select
                value={payGroupForm.payFrequency}
                onValueChange={(value) =>
                  setPayGroupForm((prev) => ({
                    ...prev,
                    payFrequency: value as PayGroupForm["payFrequency"]
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="semi_monthly">Semi Monthly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Salary Pay Day</label>
              <Input
                type="number"
                min={1}
                max={31}
                value={payGroupForm.salaryPayDay}
                onChange={(e) =>
                  setPayGroupForm((prev) => ({ ...prev, salaryPayDay: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">Work Week Days</label>
              <Input
                type="number"
                min={1}
                max={7}
                value={payGroupForm.workWeekDays}
                onChange={(e) =>
                  setPayGroupForm((prev) => ({ ...prev, workWeekDays: e.target.value }))
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">Default Basic %</label>
              <Input
                type="number"
                min={1}
                max={100}
                value={payGroupForm.basicPercent}
                onChange={(e) =>
                  setPayGroupForm((prev) => ({ ...prev, basicPercent: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPayGroupDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={savePayGroup} disabled={payGroupSaving}>
              {payGroupSaving ? "Saving..." : editingPayGroupId ? "Save Changes" : "Create Pay Group"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default PayrollSetup;
