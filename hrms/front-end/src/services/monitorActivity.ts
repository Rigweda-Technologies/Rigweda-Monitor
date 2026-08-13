import { getApiWithToken, postApiWithToken, putApiWithToken } from "@/services/apiWrapper";

export type MonitorEmployeeActivity = {
  employeeId: string;
  employeeName: string | null;
  employeeCode?: string | null;
  status: "active" | "offline";
  lastSeenAt: string | null;
  productiveSeconds: number;
};

export type MonitorScreenshot = {
  screenshotId: string;
  attendanceId: string;
  organizationId: string;
  employeeId: string;
  employeeName: string | null;
  employeeCode: string | null;
  publicId?: string | null;
  date: string;
  dateKey: string | null;
  action: "check_in" | "check_out" | string;
  capturedAt: string | null;
  imageUrl: string | null;
  selfieProvided: boolean;
  deviceId: string | null;
  ip: string | null;
  status: string | null;
  shiftName: string | null;
  shiftCode: string | null;
};

export type MonitorCloudinarySettings = {
  cloudName: string;
  apiKey: string;
  apiSecretMasked?: string;
  apiSecret?: string;
  uploadFolderRoot: string;
  updatedAt?: string;
};

export type MonitorAppUsageApp = {
  appName: string;
  processName: string;
  totalSeconds: number;
  keyPressCount: number;
  sessionCount: number;
};

export type MonitorAppUsageEmployee = {
  employeeId: string;
  employeeName: string | null;
  employeeCode?: string | null;
  totalSeconds: number;
  totalKeyPresses: number;
  sessionCount: number;
  apps: MonitorAppUsageApp[];
};

export type MonitorAppUsageSessionPage = {
  total: number;
  limit: number;
  offset: number;
  returned: number;
  hasMore: boolean;
};

export type MonitorAppUsageSession = {
  sessionId: string;
  employeeId: string;
  employeeName: string | null;
  employeeCode?: string | null;
  deviceId: string | null;
  appName: string;
  processName: string;
  observedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  activeSeconds: number;
  keyPressCount: number;
  keyNames: string[];
  typedText: string;
  keyStreamText: string;
};

export type MonitorAppKeyUsage = {
  employeeId: string;
  employeeName: string | null;
  employeeCode?: string | null;
  appName: string;
  processName: string;
  totalSeconds: number;
  keyPressCount: number;
  sessionCount: number;
  keyNames: string[];
  typedText: string;
  keyStreamText: string;
};

export const getMonitorAppKeyUsage = async (date: string) => {
  const response = await getApiWithToken(
    `/activity/app-key-usage?date=${encodeURIComponent(date)}`,
    null,
    { requiredPermissions: ["EMP_VIEW"] }
  ) as {
    success?: boolean;
    message?: string;
    data?: {
      date: string;
      timezone: string;
      appKeys: MonitorAppKeyUsage[];
    };
  };

  if (!response.success || !response.data) {
    throw new Error(response.message || "Could not load key press usage.");
  }
  return response.data;
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

export const getMonitorAppUsage = async (date: string, params?: { limit?: number; offset?: number; appName?: string; processName?: string }) => {
  const query = new URLSearchParams({ date: String(date) });
  if (typeof params?.limit === "number") query.set("limit", String(params.limit));
  if (typeof params?.offset === "number") query.set("offset", String(params.offset));
  if (params?.appName) query.set("appName", params.appName);
  if (params?.processName) query.set("processName", params.processName);
  const response = await getApiWithToken(
    `/activity/apps?${query.toString()}`,
    null,
    { requiredPermissions: ["EMP_VIEW"] }
  ) as {
    success?: boolean;
    message?: string;
    data?: {
      date: string;
      timezone: string;
      employees: MonitorAppUsageEmployee[];
      sessions: MonitorAppUsageSession[];
      sessionPage?: MonitorAppUsageSessionPage;
    };
  };

  if (!response.success || !response.data) {
    throw new Error(response.message || "Could not load app usage.");
  }
  return response.data;
};

export const getMonitorScreenshots = async (params: {
  employeeId?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  hour?: string;
  onlyWithImage?: boolean;
  page?: number;
  limit?: number;
}) => {
  const query = new URLSearchParams();
  if (params.employeeId) query.set("employeeId", params.employeeId);
  if (params.date) query.set("date", params.date);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  if (params.hour) query.set("hour", params.hour);
  if (typeof params.onlyWithImage === "boolean") query.set("onlyWithImage", String(params.onlyWithImage));
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));

  const response = await getApiWithToken(
    `/agents/screenshots${query.toString() ? `?${query}` : ""}`,
    null,
    { requiredPermissions: ["ATTENDANCE_VIEW_ALL"], forceRefresh: true }
  ) as {
    success?: boolean;
    message?: string;
    data?: { items: MonitorScreenshot[]; page: number; limit: number; count: number; total?: number };
  };

  if (!response.success || !response.data) {
    throw new Error(response.message || "Could not load monitor screenshots.");
  }
  return response.data;
};

export const getMonitorCloudinarySettings = async () => {
  const response = await getApiWithToken(
    "/agents/cloudinary",
    null,
    { requiredPermissions: ["ORG_SETTINGS_VIEW", "ATTENDANCE_VIEW_ALL"] }
  ) as { success?: boolean; message?: string; data?: MonitorCloudinarySettings | null };

  if (!response.success) {
    throw new Error(response.message || "Could not load Cloudinary settings.");
  }
  return response.data;
};

export const saveMonitorCloudinarySettings = async (payload: MonitorCloudinarySettings) => {
  const response = await putApiWithToken(
    "/agents/cloudinary",
    payload,
    null,
    { requiredPermissions: ["ORG_SETTINGS_VIEW"] }
  ) as { success?: boolean; message?: string; data?: MonitorCloudinarySettings };

  if (!response.success || !response.data) {
    throw new Error(response.message || "Could not save Cloudinary settings.");
  }
  return response.data;
};

export const testMonitorCloudinarySettings = async (payload: MonitorCloudinarySettings) => {
  const response = await postApiWithToken(
    "/agents/cloudinary/test",
    payload,
    null,
    { requiredPermissions: ["ORG_SETTINGS_VIEW"] }
  ) as { success?: boolean; message?: string; data?: { ok: boolean } };

  if (!response.success) {
    throw new Error(response.message || "Could not verify Cloudinary settings.");
  }
  return response.data;
};
