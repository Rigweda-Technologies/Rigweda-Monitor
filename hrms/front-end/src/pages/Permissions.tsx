import { useEffect, useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { DataTable, Column } from "@/components/ui/DataTable";
import { Checkbox } from "@/components/ui/checkbox";
import { getApiWithToken, putApiWithToken } from "@/services/apiWrapper";
import { toast } from "sonner";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/useAuth";

type RoleRow = {
  _id: string;
  name: string;
  slug: string;
  permissionIds: string[];
  isSystemRole?: boolean;
  [key: string]: any;
};

type Permission = {
  _id: string;
  code: string;
  name: string;
  module: string;
};

const ACCESS_GROUPS: { label: string; codes: string[] }[] = [
  {
    label: "Employee (Self)",
    codes: [
      "TIMESHEET_VIEW_SELF",
      "TIMESHEET_CREATE_SELF",
      "TIMESHEET_EDIT_SELF",
      "TIMESHEET_SUBMIT_SELF",
      "TIMESHEET_RECALL_SELF",
      "TIMESHEET_CHECKIN_SELF",
      "TIMESHEET_CHECKOUT_SELF",
      "TIMESHEET_VIEW_ONLINE",
      "LEAVE_VIEW_SELF",
      "LEAVE_APPLY"
    ]
  },
  {
    label: "Manager (Approve)",
    codes: [
      "TIMESHEET_VIEW_ALL",
      "TIMESHEET_ACTION",
      "LEAVE_VIEW_ALL",
      "LEAVE_ACTION"
    ]
  }
];

const EMPLOYEE_DEFAULT_CODES = [
  "EMP_SELF_VIEW",
  "ATTENDANCE_VIEW_SELF",
  "HOLIDAY_VIEW",
  "SHIFT_VIEW",
  "WEEK_OFF_VIEW",
  "NOTIFICATION_VIEW_SELF",
  ...(ACCESS_GROUPS.find((group) => group.label === "Employee (Self)")?.codes || [])
];

const MANAGER_DEFAULT_CODES = [
  ...EMPLOYEE_DEFAULT_CODES,
  "EMP_VIEW",
  "ATTENDANCE_VIEW_ALL",
  "ATTENDANCE_MANAGE",
  ...(ACCESS_GROUPS.find((group) => group.label === "Manager (Approve)")?.codes || [])
];

const normalizeRoleSlug = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");

const permissionLabel = (code: string) =>
  String(code || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const Permissions = () => {
  const { hasAnyPermission } = useAuth();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [savingRoleIds, setSavingRoleIds] = useState<Set<string>>(new Set());
  const [dirtyRoleIds, setDirtyRoleIds] = useState<Set<string>>(new Set());
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});

  const fetchData = async () => {
    const [rolesRes, permsRes] = await Promise.all([
      getApiWithToken("/roles", null, { requiredPermissions: ["ROLE_VIEW"] }),
      getApiWithToken("/permissions", null, { requiredPermissions: ["PERMISSION_VIEW"] }),
    ]);

    if (rolesRes?.skipped || permsRes?.skipped) {
      setRoles([]);
      setPermissions([]);
      return;
    }

    if (rolesRes?.success || rolesRes?.code === 200) {
      setRoles(rolesRes.data || []);
    } else {
      toast.error(rolesRes?.message || "Failed to load roles");
    }

    if (permsRes?.success || permsRes?.code === 200) {
      setPermissions(permsRes.data || []);
    } else {
      toast.error(permsRes?.message || "Failed to load permissions");
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (roles.length > 0) {
      const map: Record<string, string[]> = {};
      roles.forEach((r) => {
        map[r._id] = [...(r.permissionIds || [])];
      });
      setRolePerms(map);
      setDirtyRoleIds(new Set());
    }
  }, [roles]);

  const updateRolePerms = (roleId: string, nextPerms: string[]) => {
    setRolePerms((prev) => ({ ...prev, [roleId]: nextPerms }));
    setDirtyRoleIds((prev) => new Set(prev).add(roleId));
  };

  const handleToggle = (role: RoleRow, perm: Permission) => {
    if (role.isSystemRole) {
      toast.warning("System roles cannot be edited");
      return;
    }

    const current = rolePerms[role._id] || [];
    const has = current.includes(perm._id);
    const updated = has
      ? current.filter((id) => id !== perm._id)
      : [...current, perm._id];

    updateRolePerms(role._id, updated);
  };

  const handleSelectAllRole = (role: RoleRow) => {
    if (role.isSystemRole) {
      toast.warning("System roles cannot be edited");
      return;
    }
    const allPermIds = permissions.map((p) => p._id);
    const current = rolePerms[role._id] || [];
    const next =
      current.length === allPermIds.length ? [] : allPermIds;
    updateRolePerms(role._id, next);
  };

  const handleSelectAllPermission = (perm: Permission) => {
    const nextPermsMap = { ...rolePerms };
    roles.forEach((role) => {
      if (role.isSystemRole) return;
      const current = nextPermsMap[role._id] || [];
      const has = current.includes(perm._id);
      nextPermsMap[role._id] = has
        ? current.filter((id) => id !== perm._id)
        : [...current, perm._id];
    });
    setRolePerms(nextPermsMap);
    setDirtyRoleIds(new Set(roles.filter(r => !r.isSystemRole).map(r => r._id)));
  };

  const handleSaveChanges = async () => {
    if (!hasAnyPermission(["ROLE_UPDATE"])) {
      toast.error("You do not have permission to update roles");
      return;
    }
    if (dirtyRoleIds.size === 0) {
      toast.message("No changes to save");
      return;
    }

    const roleIds = Array.from(dirtyRoleIds);
    setSavingRoleIds(new Set(roleIds));

    const results = await Promise.all(
      roleIds.map((roleId) =>
        putApiWithToken(`/roles/${roleId}`, {
          permissionIds: rolePerms[roleId] || [],
        })
      )
    );

    const failed = results.find((r) => !r?.success && r?.code !== 200);
    setSavingRoleIds(new Set());

    if (failed) {
      toast.error(failed?.message || "Failed to save changes");
      return;
    }

    toast.success("Permissions updated");
    fetchData();
  };

  const handleGrantAllViewToManager = () => {
    if (!hasAnyPermission(["ROLE_UPDATE"])) {
      toast.error("You do not have permission to update roles");
      return;
    }
    const managerRole = roles.find((r) => r.slug === "manager");
    if (!managerRole) {
      toast.error("Manager role not found");
      return;
    }
    if (managerRole.isSystemRole) {
      toast.warning("System roles cannot be edited");
      return;
    }

    const viewPermIds = permissions
      .filter((p) => /_VIEW(_|$)/.test(p.code))
      .map((p) => p._id);

    if (viewPermIds.length === 0) {
      toast.message("No view permissions found");
      return;
    }

    const current = rolePerms[managerRole._id] || [];
    const merged = Array.from(new Set([...current, ...viewPermIds]));
    updateRolePerms(managerRole._id, merged);
    toast.success("View permissions added to Manager (pending save)");
  };

  const handleGrantDefaultPermissionsToEmployee = () => {
    if (!hasAnyPermission(["ROLE_UPDATE"])) {
      toast.error("You do not have permission to update roles");
      return;
    }

    const employeeRole = roles.find((r) => r.slug === "employee");
    if (!employeeRole) {
      toast.error("Employee role not found");
      return;
    }
    if (employeeRole.isSystemRole) {
      toast.warning("System roles cannot be edited");
      return;
    }

    const defaultPermIds = permissions
      .filter((permission) => EMPLOYEE_DEFAULT_CODES.includes(permission.code))
      .map((permission) => permission._id);

    if (defaultPermIds.length === 0) {
      toast.message("No default employee permissions found");
      return;
    }

    const current = rolePerms[employeeRole._id] || [];
    const merged = Array.from(new Set([...current, ...defaultPermIds]));
    updateRolePerms(employeeRole._id, merged);
    toast.success("Default permissions added to Employee (pending save)");
  };

  const handleGrantDefaultPermissionsToAllRoles = () => {
    if (!hasAnyPermission(["ROLE_UPDATE"])) {
      toast.error("You do not have permission to update roles");
      return;
    }

    const viewPermIds = permissions
      .filter((permission) => /_VIEW(_|$)/.test(permission.code))
      .map((permission) => permission._id);
    const employeeDefaultPermIds = permissions
      .filter((permission) => EMPLOYEE_DEFAULT_CODES.includes(permission.code))
      .map((permission) => permission._id);
    const managerDefaultPermIds = permissions
      .filter((permission) => MANAGER_DEFAULT_CODES.includes(permission.code))
      .map((permission) => permission._id);
    const allPermissionIds = permissions.map((permission) => permission._id);

    const nextRolePermsMap = { ...rolePerms };
    const updatedRoleIds = new Set<string>();
    let appliedCount = 0;
    let skippedCount = 0;

    roles.forEach((role) => {
      if (role.isSystemRole) {
        skippedCount += 1;
        return;
      }

      const normalizedSlug = normalizeRoleSlug(role.slug);
      const current = nextRolePermsMap[role._id] || [];
      let defaultsToApply: string[] = [];

      if (normalizedSlug === "employee") {
        defaultsToApply = employeeDefaultPermIds;
      } else if (normalizedSlug === "manager") {
        defaultsToApply = Array.from(new Set([...managerDefaultPermIds, ...viewPermIds]));
      } else if (["hr", "org-admin"].includes(normalizedSlug)) {
        defaultsToApply = allPermissionIds;
      } else {
        skippedCount += 1;
        return;
      }

      if (defaultsToApply.length === 0) return;

      nextRolePermsMap[role._id] = Array.from(new Set([...current, ...defaultsToApply]));
      updatedRoleIds.add(role._id);
      appliedCount += 1;
    });

    if (appliedCount === 0) {
      toast.message("No editable roles matched the default permission rules");
      return;
    }

    setRolePerms(nextRolePermsMap);
    setDirtyRoleIds((prev) => new Set([...prev, ...updatedRoleIds]));
    toast.success(
      skippedCount > 0
        ? `Default permissions applied to ${appliedCount} roles (${skippedCount} skipped, pending save)`
        : `Default permissions applied to all matched roles (pending save)`
    );
  };

  const orderedPermissions = useMemo(() => {
    const byCode = new Map(permissions.map((p) => [p.code, p]));
    const selected = new Set<string>();
    const ordered: Permission[] = [];

    ACCESS_GROUPS.forEach((group) => {
      group.codes.forEach((code) => {
        const perm = byCode.get(code);
        if (perm && !selected.has(perm._id)) {
          ordered.push(perm);
          selected.add(perm._id);
        }
      });
    });

    const remaining = permissions
      .filter((p) => !selected.has(p._id))
      .sort((a, b) => {
        const mod = (a.module || "").localeCompare(b.module || "");
        if (mod !== 0) return mod;
        return a.code.localeCompare(b.code);
      });

    return [...ordered, ...remaining];
  }, [permissions]);

  const columns: Column<RoleRow>[] = useMemo(() => {
    const roleColumn: Column<RoleRow> = {
      header: "Role",
      accessor: "name",
      sortable: true,
      className: "sticky left-0 z-[60] bg-white w-[220px] min-w-[220px] max-w-[220px] shadow-[2px_0_6px_-4px_rgba(0,0,0,0.2)]",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">{row.slug}</p>
        </div>
      ),
    };

    const permColumns: Column<RoleRow>[] = orderedPermissions.map((perm) => ({
      header: perm.code,
      accessor: perm.code as any,
      className: "w-[118px] min-w-[118px] max-w-[118px] px-2 text-center",
    }));

    return [roleColumn, ...permColumns];
  }, [orderedPermissions]);

  const groupedPermissions = useMemo(() => {
    const groups: Record<string, Permission[]> = {};

    ACCESS_GROUPS.forEach((group) => {
      const list = orderedPermissions.filter((p) =>
        group.codes.includes(p.code)
      );
      if (list.length) {
        groups[group.label] = list;
      }
    });

    const remaining = orderedPermissions.filter(
      (p) => !ACCESS_GROUPS.some((g) => g.codes.includes(p.code))
    );

    remaining.forEach((p) => {
      const key = p.module || "Other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    return groups;
  }, [orderedPermissions]);

  const allPermIds = useMemo(() => permissions.map((p) => p._id), [permissions]);

  const renderHeader = () => {
    return (
      <>
        <TableRow className="bg-muted/40">
          <TableHead
            rowSpan={2}
            className="sticky left-0 z-[70] bg-white w-[220px] min-w-[220px] max-w-[220px] shadow-[2px_0_6px_-4px_rgba(0,0,0,0.2)] p-0"
          >
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="w-6"></div>
              <div>
                <p className="font-bold text-sm">Role</p>
              </div>
            </div>
          </TableHead>
          {Object.entries(groupedPermissions).map(([module, perms]) => (
            <TableHead key={module} colSpan={perms.length} className="text-center">
              {module}
            </TableHead>
          ))}
        </TableRow>
        <TableRow className="bg-muted/40">
          {Object.entries(groupedPermissions).flatMap(([module, perms]) =>
            perms.map((perm) => {
              const editableRoles = roles.filter((r) => !r.isSystemRole);
              const checkedCount = editableRoles.filter((r) =>
                (rolePerms[r._id] || []).includes(perm._id)
              ).length;
              const allChecked =
                editableRoles.length > 0 && checkedCount === editableRoles.length;
              const indeterminate =
                checkedCount > 0 && checkedCount < editableRoles.length;
              return (
                <TableHead key={`${module}-${perm._id}`} className="w-[118px] min-w-[118px] max-w-[118px] px-2 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="max-w-[104px] truncate text-[11px] font-medium leading-tight" title={permissionLabel(perm.code)}>
                      {perm.code}
                    </span>
                    <Checkbox
                      checked={indeterminate ? "indeterminate" : allChecked}
                      onCheckedChange={() => handleSelectAllPermission(perm)}
                      disabled={editableRoles.length === 0}
                    />
                  </div>
                </TableHead>
              );
            })
          )}
        </TableRow>
      </>
    );
  };

  const renderRow = (row: RoleRow) => {
    const current = rolePerms[row._id] || [];
    const isAll = current.length === allPermIds.length && allPermIds.length > 0;
    const isIndeterminate =
      current.length > 0 && current.length < allPermIds.length;
    const disabled = row.isSystemRole || savingRoleIds.has(row._id);

    return (
      <>
        <TableCell className="sticky left-0 z-[60] bg-white w-[220px] min-w-[220px] max-w-[220px] shadow-[2px_0_6px_-4px_rgba(0,0,0,0.2)] p-0">
          <div className="flex items-center gap-3 px-4 py-3">
            <Checkbox
              checked={isIndeterminate ? "indeterminate" : isAll}
              disabled={disabled}
              onCheckedChange={() => handleSelectAllRole(row)}
            />
            <div>
              <p className="font-medium">{row.name}</p>
              <p className="text-xs text-muted-foreground">{row.slug}</p>
            </div>
          </div>
        </TableCell>
        {Object.entries(groupedPermissions).flatMap(([module, perms]) =>
          perms.map((perm) => {
            const checked = current.includes(perm._id);
            return (
              <TableCell key={`${row._id}-${perm._id}`} className="w-[118px] min-w-[118px] max-w-[118px] px-2 text-center">
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => handleToggle(row, perm)}
                />
              </TableCell>
            );
          })
        )}
      </>
    );
  };

  const canView = hasAnyPermission(["ROLE_VIEW", "PERMISSION_VIEW"]);
  const canUpdate = hasAnyPermission(["ROLE_UPDATE"]);

  return (
    <MainLayout
      title="Permissions"
      breadcrumb={[{ label: "Home", href: "/" }, { label: "Permissions" }]}
    >
      {!canView && (
        <div className="bg-card rounded-xl card-shadow p-6 text-sm text-muted-foreground">
          You do not have permission to view permissions.
        </div>
      )}
      {canView && (
        <>
        <div className="flex flex-col h-[calc(100vh-120px)] overflow-hidden">

          <div className="flex justify-between gap-2 mb-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleGrantDefaultPermissionsToAllRoles} disabled={!canUpdate}>
                Grant Default Permissions to All Roles
              </Button>
              <Button variant="outline" onClick={handleGrantDefaultPermissionsToEmployee} disabled={!canUpdate}>
                Grant Default Permissions to Employee
              </Button>
              <Button variant="outline" onClick={handleGrantAllViewToManager} disabled={!canUpdate}>
                Grant all View to Manager
              </Button>
            </div>
            <Button onClick={handleSaveChanges} disabled={savingRoleIds.size > 0 || !canUpdate}>
              Save Changes
            </Button>
          </div>
        
         <div className="rounded-xl border bg-white max-w-full">
           
              <DataTable
                columns={columns}
                data={roles}
                rowKey="_id"
                searchKey="name"
                tableClassName="w-max min-w-0 border-separate border-spacing-0"
                renderHeader={renderHeader}
                renderRow={renderRow}
                columnsCountOverride={1 + permissions.length}
                
              />
            </div>
          </div>
        </>
      )}
    </MainLayout>
  );
};

export default Permissions;
