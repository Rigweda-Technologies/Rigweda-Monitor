import { getApiWithToken } from "@/services/apiWrapper";

export type MonitorDiskHealth = {
  mount: string;
  filesystem?: string | null;
  totalBytes?: number | null;
  usedBytes?: number | null;
  freeBytes?: number | null;
  usedPercent?: number | null;
};

export type MonitorLaptopHealth = {
  id: string;
  deviceId: string;
  hostname?: string | null;
  platform?: string | null;
  platformVersion?: string | null;
  agentVersion?: string | null;
  cpuModel?: string | null;
  cpuCoreCount?: number | null;
  cpuPercent?: number | null;
  memoryTotalBytes?: number | null;
  memoryUsedBytes?: number | null;
  memoryPercent?: number | null;
  disks: MonitorDiskHealth[];
  temperatureC?: number | null;
  batteryPercent?: number | null;
  batteryCharging?: boolean | null;
  uptimeSeconds?: number | null;
  lastSeenAt: string;
  employee?: { id: string; name: string; code?: string | null } | null;
};

export async function getMonitorLaptopHealth() {
  const response = await getApiWithToken("/activity/laptop-health", null, { requiredPermissions: ["EMP_VIEW"], forceRefresh: true }) as {
    success?: boolean;
    message?: string;
    data?: MonitorLaptopHealth[];
  };
  if (!response.success || !response.data) throw new Error(response.message || "Could not load laptop health.");
  return response.data;
}
