import { useEffect, useState } from "react";
import { Cpu, HardDrive, MemoryStick, RefreshCw, Thermometer, Wifi } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { getMonitorLaptopHealth, type MonitorLaptopHealth } from "@/services/monitorHealth";

const formatBytes = (value?: number | null) => {
  if (!value || value < 0) return "-";
  const units = ["B", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
};

const formatUptime = (seconds?: number | null) => {
  if (!seconds) return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days}d ${hours}h` : `${hours}h`;
};

const isOnline = (lastSeenAt: string) => Date.now() - new Date(lastSeenAt).getTime() < 10 * 60 * 1000;

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
      <Card><CardHeader><CardTitle>Monitored devices</CardTitle><CardDescription>{items.length} device{items.length === 1 ? "" : "s"} reporting health snapshots.</CardDescription></CardHeader><CardContent className="p-0">
        {loading ? <div className="px-6 py-10 text-sm text-slate-500">Loading laptop health...</div> : items.length === 0 ? <div className="px-6 py-10 text-sm text-slate-500">No agent health reports have been received yet.</div> : <Table><TableHeader><TableRow><TableHead>Employee / device</TableHead><TableHead>Memory</TableHead><TableHead>Storage</TableHead><TableHead>CPU</TableHead><TableHead>Temperature</TableHead><TableHead>Agent version</TableHead><TableHead>Last seen</TableHead></TableRow></TableHeader><TableBody>{items.map((item) => { const online = isOnline(item.lastSeenAt); const disk = item.disks?.[0]; return <TableRow key={item.id}><TableCell><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-slate-300"}`} /><div><div className="font-semibold">{item.employee?.name || "Unassigned device"}</div><div className="text-xs text-slate-500">{item.employee?.code || item.hostname || item.deviceId}</div></div></div></TableCell><TableCell><div className="flex items-center gap-2 whitespace-nowrap"><MemoryStick size={15} className="text-slate-400" />{formatBytes(item.memoryUsedBytes)} / {formatBytes(item.memoryTotalBytes)}<span className="text-xs text-slate-500">({item.memoryPercent ?? "-"}%)</span></div></TableCell><TableCell><div className="flex items-center gap-2 whitespace-nowrap"><HardDrive size={15} className="text-slate-400" />{formatBytes(disk?.usedBytes)} / {formatBytes(disk?.totalBytes)}<span className="text-xs text-slate-500">({disk?.usedPercent ?? "-"}%)</span></div></TableCell><TableCell><div className="flex items-center gap-2 whitespace-nowrap"><Cpu size={15} className="text-slate-400" />{item.cpuPercent ?? "-"}%</div></TableCell><TableCell><div className="flex items-center gap-2 whitespace-nowrap"><Thermometer size={15} className="text-slate-400" />{item.temperatureC != null ? `${item.temperatureC}°C` : "Unavailable"}</div></TableCell><TableCell><Badge variant="secondary">{item.agentVersion || "Unknown"}</Badge></TableCell><TableCell><div className="flex items-center gap-2 whitespace-nowrap"><Wifi size={15} className={online ? "text-emerald-500" : "text-slate-400"} />{online ? "Online" : "Offline"}<span className="text-xs text-slate-500">{new Date(item.lastSeenAt).toLocaleString()}</span></div></TableCell></TableRow>; })}</TableBody></Table>}
      </CardContent></Card>
    </div>
  </MainLayout>;
}
