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
  try {
    const response = await fetch(buildHrmsApiUrl(path), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return { ok: false, status: response.status, text: await response.text() };
    }

    return { ok: true, payload: await response.json() };
  } catch (error) {
    return {
      ok: false,
      status: "NETWORK_ERROR",
      text: error instanceof Error ? error.message : String(error),
    };
  }
};

export const getEmployeeProfileFromRigweda = async ({ token }) => {
  const attempts = [
    await fetchProfileCandidate({ token, path: "/api/employees/me" }),
    await fetchProfileCandidate({ token, path: "/api/users/me/profile" }),
  ];

  const success = attempts.find((attempt) => attempt.ok);
  if (!success) {
    return null;
  }

  const data = success.payload?.data ?? null;

  if (!data) {
    return null;
  }

  const employeeCode =
    data.employeeCode ||
    data.employee?.employeeCode ||
    data.employee?.code ||
    null;
  const employeeDbId = data.employeeId || data._id || data.id || null;

  return {
    employeeId: employeeDbId || data.userId || null,
    employeeCode,
    employeeDbId,
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

export const getMonitorUsbSettingsFromRigweda = async ({ token }) => {
  const response = await fetch(buildHrmsApiUrl("/api/agents/usb/control-config"), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload?.data) {
    throw new Error(payload?.message || `Failed to fetch USB monitor settings: ${response.status}`);
  }

  return payload.data;
};
