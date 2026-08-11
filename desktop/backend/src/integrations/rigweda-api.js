import { getEnv } from "../config/env.js";

const buildHrmsApiUrl = (path) => {
  const baseUrl = getEnv().hrmsBackendUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (baseUrl.endsWith("/api")) {
    return `${baseUrl}${normalizedPath.startsWith("/api/") ? normalizedPath.slice(4) : normalizedPath}`;
  }
  return `${baseUrl}${normalizedPath}`;
};

const fetchProfileCandidate = async ({ token, path }) => {
  const response = await fetch(buildHrmsApiUrl(path), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return { ok: false, status: response.status, text: await response.text() };
  }

  return { ok: true, payload: await response.json() };
};

export const getEmployeeProfileFromRigweda = async ({ token }) => {
  const attempts = [
    await fetchProfileCandidate({ token, path: "/api/employees/me" }),
    await fetchProfileCandidate({ token, path: "/api/users/me/profile" }),
  ];

  const success = attempts.find((attempt) => attempt.ok);
  if (!success) {
    const last = attempts.at(-1);
    throw new Error(`Failed to resolve employee profile: ${last?.status} ${last?.text}`);
  }

  const data = success.payload?.data ?? null;

  if (!data) {
    return null;
  }

  const employeeId = data._id || data.id || data.employeeId || data.userId;

  return {
    employeeId,
    employeeCode: data.employeeCode || null,
    userId: data.userId || null,
    organizationId: data.organizationId || data.organization?._id || null,
    raw: data,
  };
};

export const getMonitorCloudinarySettingsFromRigweda = async ({ token }) => {
  const response = await fetch(buildHrmsApiUrl("/api/agents/cloudinary/upload-config"), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload?.data) {
    throw new Error(payload?.message || `Failed to fetch Cloudinary monitor settings: ${response.status}`);
  }

  return payload.data;
};
