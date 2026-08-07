import {Fragment, useEffect, useMemo, useState, type FormEvent} from "react";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {Check, List, MagnifyingGlass, Palette, Plus, Shield, UsersThree, X} from "@phosphor-icons/react";
import {useAuth} from "../features/auth/AuthProvider";
import {accessApi, type AccessUser, type Permission, type Role} from "../features/access/access.api";

type RoleDraft = Role & { draftPermissions: string[] };

function groupPermissions(permissions: Permission[]) {
  const groups = new Map<string, Permission[]>();
  for (const permission of permissions) {
    const key = permission.module || "general";
    const existing = groups.get(key) || [];
    existing.push(permission);
    groups.set(key, existing);
  }
  return Array.from(groups.entries()).map(([module, items]) => ({ module, items }));
}

function UserEditor({roles, onClose}: {roles: Role[]; onClose: () => void}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    initialPassword: "",
    roleId: roles.find((role) => role.key === "employee")?.id || roles[0]?.id || ""
  });
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => accessApi.createUser(form),
    onSuccess: () => {
      queryClient.invalidateQueries({queryKey: ["access-users"]});
      onClose();
    },
    onError: (e) => setError((e as {response?: {data?: {error?: {message?: string}}}}).response?.data?.error?.message || "Unable to create user.")
  });

  return (
    <div className="editor-layer">
      <form className="access-editor" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <header>
          <div>
            <span>ACCESS CONTROL</span>
            <h2>Invite a workspace member</h2>
            <p>Create credentials and assign a starting role.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}><X /></button>
        </header>
        <div className="access-form">
          <label>Full name<input required minLength={2} value={form.displayName} onChange={(e) => setForm({...form, displayName: e.target.value})} /></label>
          <label>Email address<input required type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} /></label>
          <label>Temporary password<input required type="password" minLength={12} value={form.initialPassword} onChange={(e) => setForm({...form, initialPassword: e.target.value})} /><small>Use 12+ characters with mixed case, number, and symbol.</small></label>
          <label>Initial role<select required value={form.roleId} onChange={(e) => setForm({...form, roleId: e.target.value})}>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button className="primary-button" disabled={save.isPending}>{save.isPending ? "Creating…" : "Create member"}</button>
        </footer>
      </form>
    </div>
  );
}

function AccessSummary({users, roles, permissions}: {users: number; roles: number; permissions: number}) {
  return (
    <section className="access-summary">
      <article><span><UsersThree /></span><div><small>Members</small><strong>{users}</strong><em>active workspace users</em></div></article>
      <article><span><Shield /></span><div><small>Roles</small><strong>{roles}</strong><em>permission sets</em></div></article>
      <article><span><Check /></span><div><small>Rules</small><strong>{permissions}</strong><em>available access checks</em></div></article>
    </section>
  );
}

function AccessRoleMatrix({
  roles,
  permissions,
  onToggle,
  onSave,
  saving
}: {
  roles: RoleDraft[];
  permissions: Permission[];
  onToggle: (roleId: string, permissionKey: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const grouped = useMemo(() => groupPermissions(permissions), [permissions]);

  return (
    <div className="access-matrix card">
      <div className="access-matrix-topbar">
        <div className="search-box access-search">
          <MagnifyingGlass />
          <input aria-label="Search roles" placeholder="Search..." />
        </div>
        <div className="access-actions">
          <button type="button" className="secondary-button">Grant base access to all roles</button>
          <button type="button" className="secondary-button">Grant base access to members</button>
          <button type="button" className="secondary-button">Allow all approvals to leads</button>
        </div>
        <button type="button" className="primary-button" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
      <div className="access-scroll">
        <div className="access-grid" style={{gridTemplateColumns: `220px repeat(${permissions.length}, minmax(72px, 1fr))`}}>
          <div className="access-sticky access-role-head">Role</div>
          {grouped.flatMap((group) => group.items.map((permission, index) => (
            <div className="access-column-head" key={permission.key} title={permission.description}>
              <small>{group.module}</small>
              <span>{permission.name}</span>
              <b>{index === 0 ? group.items.length : ""}</b>
            </div>
          )))}
          {roles.map((role) => (
            <Fragment key={role.id}>
              <div className="access-sticky access-role-cell">
                <span className={`role-marker ${role.isSystem ? "filled" : ""}`} />
                <div>
                  <strong>{role.name}</strong>
                  <small>{role.key}</small>
                </div>
              </div>
              {permissions.map((permission) => {
                const checked = role.draftPermissions.includes(permission.key);
                return (
                  <button
                    key={`${role.id}-${permission.key}`}
                    type="button"
                    className={`access-toggle ${checked ? "checked" : ""}`}
                    onClick={() => onToggle(role.id, permission.key)}
                    aria-pressed={checked}
                    title={`${role.name}: ${permission.name}`}
                  >
                    {checked ? <Check weight="bold" /> : <span />}
                  </button>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PeoplePage({onTheme, onMenu}: {onTheme: () => void; onMenu: () => void}) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [userOpen, setUserOpen] = useState(false);

  const usersQuery = useQuery({queryKey: ["access-users", search], queryFn: () => accessApi.users(search)});
  const rolesQuery = useQuery({queryKey: ["roles"], queryFn: accessApi.roles});
  const permissionsQuery = useQuery({queryKey: ["permissions"], queryFn: accessApi.permissions});
  const [draftRoles, setDraftRoles] = useState<RoleDraft[]>([]);

  useEffect(() => {
    if (!rolesQuery.data) return;
    setDraftRoles(rolesQuery.data.map((role) => ({...role, draftPermissions: [...role.permissions]})));
  }, [rolesQuery.data]);

  const togglePermission = (roleId: string, permissionKey: string) => {
    setDraftRoles((current) => current.map((role) => {
      if (role.id !== roleId) return role;
      const draftPermissions = role.draftPermissions.includes(permissionKey)
        ? role.draftPermissions.filter((key) => key !== permissionKey)
        : [...role.draftPermissions, permissionKey];
      return {...role, draftPermissions};
    }));
  };

  const bulkSave = useMutation({
    mutationFn: async () => {
      await Promise.all(draftRoles.map((role) => accessApi.updateRole(role.id, {
        name: role.name,
        description: role.description,
        permissionKeys: role.draftPermissions
      })));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ["roles"]}),
        queryClient.invalidateQueries({queryKey: ["permissions"]}),
        queryClient.invalidateQueries({queryKey: ["access-users"]})
      ]);
    }
  });

  return (
    <main className="main-content">
      <header className="topbar">
        <button className="mobile-menu icon-button" onClick={onMenu}><List /></button>
        <div className="topbar-copy">
          <span>Workspace governance</span>
          <strong>Permissions</strong>
        </div>
        <div className="topbar-actions">
          <button className="theme-trigger" onClick={onTheme}><Palette />Theme</button>
          <div className="avatar">MK</div>
        </div>
      </header>
      <div className="people-wrap access-wrap">
        <section className="page-heading access-heading">
          <div>
            <span className="eyebrow dark"><Shield />ACCESS MATRIX</span>
            <h1>Access rules</h1>
            <p>Manage role-based rules for member, lead, and approval workflows.</p>
          </div>
          {hasPermission("users.manage") && <button className="primary-button" onClick={() => setUserOpen(true)}><Plus />Add member</button>}
        </section>

        <AccessSummary
          users={usersQuery.data?.total || 0}
          roles={rolesQuery.data?.length || 0}
          permissions={permissionsQuery.data?.length || 0}
        />

        <AccessRoleMatrix
          roles={draftRoles}
          permissions={permissionsQuery.data || []}
          onToggle={togglePermission}
          onSave={() => bulkSave.mutate()}
          saving={bulkSave.isPending}
        />

        <section className="access-footer-card card">
          <div>
            <strong>Recently active members</strong>
            <p>Keep visibility into who has access to the workspace.</p>
          </div>
          <div className="access-member-list">
            {(usersQuery.data?.items || []).slice(0, 10).map((user: AccessUser) => (
              <article key={user.id}>
                <span>{user.displayName.slice(0, 2).toUpperCase()}</span>
                <div>
                  <strong>{user.displayName}</strong>
                  <small>{user.email}</small>
                </div>
                <em>{user.roleName}</em>
              </article>
            ))}
          </div>
        </section>
      </div>
      {userOpen && <UserEditor roles={rolesQuery.data || []} onClose={() => setUserOpen(false)} />}
    </main>
  );
}
