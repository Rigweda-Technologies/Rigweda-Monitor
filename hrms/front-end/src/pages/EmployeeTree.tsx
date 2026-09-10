import { useEffect, useState, useMemo, useCallback, useRef, type PointerEvent } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { getApiWithToken } from "@/services/apiWrapper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Users,
  Network,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ArrowLeft,
} from "lucide-react";
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

function findTreeNode(nodes: TreeNode[], employeeId: string | null): TreeNode | null {
  if (!employeeId) return null;
  for (const node of nodes) {
    if (node._id === employeeId) return node;
    const match = findTreeNode(node.children, employeeId);
    if (match) return match;
  }
  return null;
}

const TreeNodeCard = ({
  node,
  depth,
  expandSignal,
  searchActive,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expandSignal: { expand: boolean; version: number } | null;
  searchActive: boolean;
  onSelect: (node: TreeNode) => void;
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
    <div className="org-tree-node">
      <div className="relative flex items-start">
        <div className="absolute -left-9 top-6 flex h-6 w-6 items-center justify-center">
          {hasChildren ? (
            <button
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((prev) => !prev);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : (
            <div className="h-2 w-2 rounded-full border border-border bg-background" />
          )}
        </div>

        <button
          type="button"
          onClick={() => onSelect(node)}
          className="flex w-[20rem] cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition-all hover:border-primary/50 hover:shadow-[0_12px_30px_rgba(15,23,42,0.12)] focus:outline-none focus:ring-2 focus:ring-primary/35 sm:w-[24rem]"
        >
          <Avatar className="w-9 h-9 shrink-0">
            <AvatarImage src={node.profileImage || undefined} />
            <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-amber-500 text-white text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="truncate text-sm font-semibold text-foreground">{fullName}</p>
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
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-visible"
          >
            <div
              className={`org-children ${
                node.children.length === 1 ? "org-children-single" : ""
              }`}
            >
              {node.children.map((child) => (
                <div key={child._id} className="org-child">
                  <TreeNodeCard
                    node={child}
                    depth={depth + 1}
                    expandSignal={expandSignal}
                    searchActive={searchActive}
                    onSelect={onSelect}
                  />
                </div>
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
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
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
  const selectedRoot = useMemo(
    () => findTreeNode(tree, selectedRootId),
    [tree, selectedRootId]
  );
  const visibleTree = useMemo(
    () => (selectedRoot ? [selectedRoot] : tree),
    [selectedRoot, tree]
  );
  const filteredTree = useMemo(
    () => filterTree(visibleTree, searchQuery),
    [visibleTree, searchQuery]
  );

  const handleExpandAll = () =>
    setExpandSignal((prev) => ({ expand: true, version: (prev?.version ?? 0) + 1 }));
  const handleCollapseAll = () =>
    setExpandSignal((prev) => ({ expand: false, version: (prev?.version ?? 0) + 1 }));
  const clampZoom = (value: number) => Math.min(1.4, Math.max(0.45, Number(value.toFixed(2))));
  const handleZoomIn = () => setZoom((prev) => clampZoom(prev + 0.1));
  const handleZoomOut = () => setZoom((prev) => clampZoom(prev - 0.1));
  const handleResetView = () => {
    setZoom(0.85);
    const viewport = document.getElementById("employee-tree-canvas");
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button,input,a")) return;
    setIsPanning(true);
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!isPanning || !panStartRef.current) return;
    event.currentTarget.scrollLeft =
      panStartRef.current.scrollLeft - (event.clientX - panStartRef.current.x);
    event.currentTarget.scrollTop =
      panStartRef.current.scrollTop - (event.clientY - panStartRef.current.y);
  };
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    panStartRef.current = null;
  };
  const handleSelectRoot = (node: TreeNode) => {
    setSelectedRootId(node._id);
    setSearchQuery("");
    setExpandSignal((prev) => ({ expand: true, version: (prev?.version ?? 0) + 1 }));
    requestAnimationFrame(handleResetView);
  };
  const handleBackToFullTree = () => {
    setSelectedRootId(null);
    setSearchQuery("");
    setExpandSignal((prev) => ({ expand: true, version: (prev?.version ?? 0) + 1 }));
    requestAnimationFrame(handleResetView);
  };

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
          <h2 className="text-lg font-semibold">
            {selectedRoot ? `${selectedRoot.firstName || ""} ${selectedRoot.lastName || ""}`.trim() || "Employee Tree" : "Organization Tree"}
          </h2>
          {!loading && (
            <Badge variant="outline" className="text-xs">
              {selectedRoot ? `${countDescendants(selectedRoot) + 1} employees` : `${employees.length} employees`}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {selectedRoot && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleBackToFullTree}
              disabled={loading}
            >
              <ArrowLeft className="w-3.5 h-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Back</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomOut}
            disabled={loading || zoom <= 0.45}
          >
            <ZoomOut className="w-3.5 h-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Zoom Out</span>
          </Button>
          <Badge variant="outline" className="flex h-9 min-w-16 items-center justify-center px-3 text-xs">
            {Math.round(zoom * 100)}%
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomIn}
            disabled={loading || zoom >= 1.4}
          >
            <ZoomIn className="w-3.5 h-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Zoom In</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetView}
            disabled={loading}
          >
            <RotateCcw className="w-3.5 h-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Reset</span>
          </Button>
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
        <div
          id="employee-tree-canvas"
          className={`relative h-[calc(100vh-260px)] min-h-[520px] overflow-auto rounded-xl border border-border bg-card/40 shadow-[0_10px_30px_rgba(15,23,42,0.08)] ${
            isPanning ? "cursor-grabbing" : "cursor-grab"
          }`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            className="inline-block min-w-max origin-top-left p-8 pr-20 pb-20"
            style={{
              transform: `scale(${zoom})`,
              transition: isPanning ? "none" : "transform 160ms ease",
            }}
          >
            <div className="flex items-start justify-start gap-12">
              {filteredTree.map((root) => (
                <TreeNodeCard
                  key={root._id}
                  node={root}
                  depth={0}
                  expandSignal={expandSignal}
                  searchActive={Boolean(searchQuery.trim())}
                  onSelect={handleSelectRoot}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </MainLayout>
  );
};

export default EmployeeTree;
