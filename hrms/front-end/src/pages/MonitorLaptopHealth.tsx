import { useEffect, useState, type ReactNode } from "react";
import { Cpu, HardDrive, MemoryStick, RefreshCw, Thermometer, Wifi } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { getMonitorLaptopHealth, type MonitorLaptopHealth } from "@/services/monitorHealth";

const formatBytes = (value?: number | null) => {
  if (!value || value < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
};

const formatPercent = (value?: number | null) => {
  if (value == null) return "-";
  return `${Number(value).toFixed(1).replace(/\.0$/, "")}%`;
};

const isOnline = (lastSeenAt: string) => Date.now() - new Date(lastSeenAt).getTime() < 10 * 60 * 1000;
const smoothCardShadow = "shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition-shadow hover:shadow-[0_14px_36px_rgba(15,23,42,0.12)]";

const HoverDetail = ({ children, content }: { children: ReactNode; content: ReactNode }) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent className="max-w-sm whitespace-normal break-words">
      {content}
    </TooltipContent>
  </Tooltip>
);

export default function MonitorLaptopHealth() {
  const [items, setItems] = useState<MonitorLaptopHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try { setItems(await getMonitorLaptopHealth()); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not load laptop health."); }
    finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  return <MainLayout title="Laptop Health" breadcrumb={[{ label: "Home", href: "/" }, { label: "Rigweda Monitor" }, { label: "Laptop Health" }]}>
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-600">Rigweda Monitor</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Laptop Health</h1><p className="mt-1 text-sm text-slate-500">Live device capacity, temperature, connectivity, and installed agent versions.</p></div>
        <Button variant="outline" className="gap-2" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "animate-spin" : ""} />Refresh</Button>
      </div>
      <Card className={smoothCardShadow}><CardHeader><CardTitle>Monitored devices</CardTitle><CardDescription>{items.length} device{items.length === 1 ? "" : "s"} reporting health snapshots.</CardDescription></CardHeader><CardContent className="p-0">
        {loading ? <div className="px-6 py-10 text-sm text-slate-500">Loading laptop health...</div> : items.length === 0 ? <div className="px-6 py-10 text-sm text-slate-500">No agent health reports have been received yet.</div> : <TooltipProvider delayDuration={250}><div className="max-h-[calc(100vh-270px)] overflow-auto">
          <Table className="min-w-[1320px] text-sm">
            <TableHeader className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_rgba(226,232,240,1)]">
              <TableRow>
                <TableHead className="sticky left-0 z-30 w-[260px] bg-slate-50">Employee / device</TableHead>
                <TableHead className="w-[190px]">RAM</TableHead>
                <TableHead className="w-[230px]">ROM / hard disk</TableHead>
                <TableHead className="w-[260px]">Processor</TableHead>
                <TableHead className="w-[120px]">CPU load</TableHead>
                <TableHead className="w-[130px]">Temperature</TableHead>
                <TableHead className="w-[120px]">Agent</TableHead>
                <TableHead className="w-[170px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const online = isOnline(item.lastSeenAt);
                const disk = item.disks?.[0];
                const employeeName = item.employee?.name || "Unassigned device";
                const employeeCode = item.employee?.code || "No employee code";
                const deviceName = item.hostname || item.deviceId;
                const diskDetails = [disk?.mount, disk?.filesystem].filter(Boolean).join(" • ") || "Disk details unavailable";
                const processorModel = item.cpuModel || "Processor model unavailable";
                const lastSeen = new Date(item.lastSeenAt).toLocaleString();
                return <TableRow key={item.id} className="align-top">
                  <TableCell className="sticky left-0 z-10 bg-white shadow-[1px_0_0_rgba(226,232,240,1)]">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-emerald-500" : "bg-slate-300"}`} />
                      <div className="min-w-0">
                        <HoverDetail content={<div><div className="font-semibold">{employeeName}</div><div>{employeeCode}</div><div>{deviceName}</div></div>}>
                          <div className="cursor-default break-words font-semibold text-slate-900">{employeeName}</div>
                        </HoverDetail>
                        <div className="mt-1 text-xs text-slate-500">{employeeCode}</div>
                        <HoverDetail content={deviceName}>
                          <div className="mt-0.5 cursor-default truncate text-xs text-slate-500">{deviceName}</div>
                        </HoverDetail>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <MemoryStick size={15} className="mt-0.5 shrink-0 text-slate-400" />
                      <div>
                        <div className="font-semibold text-slate-900">{formatBytes(item.memoryTotalBytes)} total</div>
                        <div className="text-xs text-slate-500">{formatBytes(item.memoryUsedBytes)} used, {formatPercent(item.memoryPercent)}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <HardDrive size={15} className="mt-0.5 shrink-0 text-slate-400" />
                      <div>
                        <div className="font-semibold text-slate-900">{formatBytes(disk?.totalBytes)} total</div>
                        <div className="text-xs text-slate-500">{formatBytes(disk?.usedBytes)} used, {formatPercent(disk?.usedPercent)}</div>
                        <HoverDetail content={diskDetails}>
                          <div className="mt-0.5 cursor-default truncate text-xs text-slate-500">{diskDetails}</div>
                        </HoverDetail>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <Cpu size={15} className="mt-0.5 shrink-0 text-slate-400" />
                      <div>
                        <HoverDetail content={processorModel}>
                          <div className="line-clamp-2 cursor-default font-semibold text-slate-900">{processorModel}</div>
                        </HoverDetail>
                        <div className="text-xs text-slate-500">{item.cpuCoreCount ? `${item.cpuCoreCount} cores` : "Core count unavailable"}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{formatPercent(item.cpuPercent)}</TableCell>
                  <TableCell><div className="flex items-center gap-2 whitespace-nowrap"><Thermometer size={15} className="text-slate-400" />{item.temperatureC != null ? `${item.temperatureC}°C` : "Unavailable"}</div></TableCell>
                  <TableCell><HoverDetail content={`Agent version ${item.agentVersion || "Unknown"}`}><Badge variant="secondary" className="cursor-default">{item.agentVersion || "Unknown"}</Badge></HoverDetail></TableCell>
                  <TableCell><HoverDetail content={<div><div>{online ? "Online" : "Offline"}</div><div>Last seen {lastSeen}</div></div>}><div className="cursor-default space-y-1"><div className="flex items-center gap-2 whitespace-nowrap"><Wifi size={15} className={online ? "text-emerald-500" : "text-slate-400"} />{online ? "Online" : "Offline"}</div><div className="truncate text-xs text-slate-500">{lastSeen}</div></div></HoverDetail></TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        </div></TooltipProvider>}
      </CardContent></Card>
    </div>
  </MainLayout>;
}
