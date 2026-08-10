import { getApiWithToken } from "@/services/apiWrapper";

export type MonitorEmployeeActivity = {
  employeeId: string;
  employeeName: string | null;
  status: "active" | "offline";
  lastSeenAt: string | null;
  productiveSeconds: number;
};

export const getMonitorEmployeeActivity = async (date: string) => {
  const response = await getApiWithToken(
    `/activity/employees?date=${encodeURIComponent(date)}`,
    null,
    { requiredPermissions: ["EMP_VIEW"] }
  ) as { success?: boolean; message?: string; data?: { date: string; employees: MonitorEmployeeActivity[] } };

  if (!response.success || !response.data) {
    throw new Error(response.message || "Could not load monitor activity.");
  }
  return response.data;
};
