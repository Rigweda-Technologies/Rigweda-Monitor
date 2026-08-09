import { getEnv } from "../config/env.js";

const fetchProfileCandidate = async ({ token, path }) => {
  const response = await fetch(`${getEnv().rigwedaApiBaseUrl}${path}`, {
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
    await fetchProfileCandidate({ token, path: "/api/users/me/profile" }),
    await fetchProfileCandidate({ token, path: "/api/employees/me" }),
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
    userId: data.userId || null,
    organizationId: data.organizationId || data.organization?._id || null,
    raw: data,
  };
};
