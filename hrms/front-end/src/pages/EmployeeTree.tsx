import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { getApiWithToken } from "@/services/apiWrapper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronDown, ChevronRight, Search, Users, Network, Maximize2, Minimize2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type RawEmployee = {
  _id: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  departmentId?: { _id?: string; name?: string } | null;
  designationId?: { _id?: string; name?: string } | null;
  managerId?: { _id?: string; firstName?: string; lastName?: string } | string | null;
  status?: string;
  employmentLifecycleStatus?: string;
  profileImage?: string | null;
  roleIds?: { _id?: string; name?: string; slug?: string }[];
};

type TreeNode = RawEmployee & {
  children: TreeNode[];
};

function buildTree(employees: RawEmployee[]): TreeNode[] {
  const byId: Record<string, TreeNode> = {};
  employees.forEach((e) => {
    byId[e._id] = { ...e, children: [] };
  });

  const roots: TreeNode[] = [];
  employees.forEach((e) => {
    const mgId =
      typeof e.managerId === "object" && e.managerId !== null
        ? e.managerId._id
        : (e.managerId as string | undefined);
    if (mgId && byId[mgId]) {
      byId[mgId].children.push(byId[e._id]);
    } else {
      roots.push(byId[e._id]);
    }
  });

  return roots;
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return nodes;
  const q = query.toLowerCase();
  return nodes.reduce<TreeNode[]>((acc, node) => {
    const filteredChildren = filterTree(node.children, query);
    const fullName = `${node.firstName || ""} ${node.lastName || ""}`.toLowerCase();
    const matches =
      fullName.includes(q) ||
      (node.employeeCode || "").toLowerCase().includes(q) ||
      (node.designationId?.name || "").toLowerCase().includes(q) ||
      (node.departmentId?.name || "").toLowerCase().includes(q);
    if (matches || filteredChildren.length > 0) {
      acc.push({ ...node, children: filteredChildren });
    }
    return acc;
  }, []);
}

function countDescendants(node: TreeNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

const TreeNodeCard = ({
  node,
  depth,
  expandSignal,
  searchActive,
}: {
  node: TreeNode;
  depth: number;
  expandSignal: { expand: boolean; version: number } | null;
  searchActive: boolean;
}) => {
  const [expanded, setExpanded] = useState(true);
  const signalVersionRef = useRef<number | null>(null);
  const hasChildren = node.children.length > 0;
  const descendantCount = useMemo(() => countDescendants(node), [node]);

  useEffect(() => {
    if (!expandSignal) return;
    if (signalVersionRef.current === expandSignal.version) return;
    signalVersionRef.current = expandSignal.version;
    setExpanded(expandSignal.expand);
  }, [expandSignal]);

  useEffect(() => {
    if (searchActive) setExpanded(true);
  }, [searchActive]);

  const initials =
    `${node.firstName?.[0] || ""}${node.lastName?.[0] || ""}`.toUpperCase() || "?";
  const fullName =
    `${node.firstName || ""} ${node.lastName || ""}`.trim() || "Unnamed";

  return (
    <div>
      <div className="flex items-start gap-2 py-1">
        <div className="flex items-center justify-center w-6 pt-3 shrink-0">
          {hasChildren ? (
            <button
              onClick={() => setExpanded((prev) => !prev)}
              className="w-5 h-5 rounded-md border border-border bg-background hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
          ) : (
            <div className="w-1.5 h-1.5 rounded-full bg-border/70 ml-1.5 mt-0.5" />
          )}
        </div>

        <div className="flex-1 flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.07)] hover:border-border/90 transition-all">
          <Avatar className="w-9 h-9 shrink-0">
            <AvatarImage src={node.profileImage || undefined} />
            <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-violet-500 text-white text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-foreground">{fullName}</p>
              {node.employeeCode && (
                <span className="text-[10px] text-muted-foreground font-mono">
                  #{node.employeeCode}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {node.designationId?.name && (
                <span className="text-[11px] text-muted-foreground">
                  {node.designationId.name}
                </span>
              )}
              {node.designationId?.name && node.departmentId?.name && (
                <span className="text-[10px] text-muted-foreground/40">•</span>
              )}
              {node.departmentId?.name && (
                <span className="text-[11px] text-muted-foreground">
                  {node.departmentId.name}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            {hasChildren && !expanded && descendantCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                +{descendantCount} below
              </Badge>
            )}
            {hasChildren && expanded && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground">
                {node.children.length} direct
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 capitalize ${
                node.status === "active"
                  ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                  : "border-muted text-muted-foreground"
              }`}
            >
              {node.status || "active"}
            </Badge>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-3 pl-4 border-l border-border/50">
              {node.children.map((child) => (
                <TreeNodeCard
                  key={child._id}
                  node={child}
                  depth={depth + 1}
                  expandSignal={expandSignal}
                  searchActive={searchActive}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const EmployeeTree = () => {
  const [employees, setEmployees] = useState<RawEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandSignal, setExpandSignal] = useState<{
    expand: boolean;
    version: number;
  } | null>(null);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    const res = await getApiWithToken("/employees?scope=organizationTree", null, {
      requiredPermissions: ["EMP_VIEW", "EMP_ORG_TREE_VIEW", "EMP_SELF_VIEW"],
    });
    if (res?.success) {
      setEmployees(res.data?.items || res.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const tree = useMemo(() => buildTree(employees), [employees]);
  const filteredTree = useMemo(
    () => filterTree(tree, searchQuery),
    [tree, searchQuery]
  );

  const handleExpandAll = () =>
    setExpandSignal((prev) => ({ expand: true, version: (prev?.version ?? 0) + 1 }));
  const handleCollapseAll = () =>
    setExpandSignal((prev) => ({ expand: false, version: (prev?.version ?? 0) + 1 }));

  return (
    <MainLayout
      title="Organization Tree"
      breadcrumb={[
        { label: "Home" },
        { label: "Employees" },
        { label: "Organization Tree" },
      ]}
    >
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Organization Tree</h2>
          {!loading && (
            <Badge variant="outline" className="text-xs">
              {employees.length} employees
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExpandAll}
            disabled={loading}
          >
            <Maximize2 className="w-3.5 h-3.5 mr-1.5" />
            Expand All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCollapseAll}
            disabled={loading}
          >
            <Minimize2 className="w-3.5 h-3.5 mr-1.5" />
            Collapse All
          </Button>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          className="pl-9"
          placeholder="Search by name, code, designation or department…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-xl border border-border/50"
              style={{ marginLeft: `${(i % 3) * 36}px` }}
            >
              <Skeleton className="w-9 h-9 rounded-full shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : filteredTree.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/40 p-16 text-center text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-25" />
          <p className="text-sm font-medium">
            {searchQuery ? "No employees match your search" : "No employees found"}
          </p>
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={() => setSearchQuery("")}
            >
              Clear search
            </Button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card/40 p-4">
          {filteredTree.map((root) => (
            <TreeNodeCard
              key={root._id}
              node={root}
              depth={0}
              expandSignal={expandSignal}
              searchActive={Boolean(searchQuery.trim())}
            />
          ))}
        </div>
      )}
    </MainLayout>
  );
};

export default EmployeeTree;
