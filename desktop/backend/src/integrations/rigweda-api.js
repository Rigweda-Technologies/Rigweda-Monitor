import { getEnv } from "../config/env.js";

export const getEmployeeProfileFromRigweda = async ({ token }) => {
  const response = await fetch(`${getEnv().rigwedaApiBaseUrl}/api/employees/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to resolve employee profile: ${response.status} ${text}`);
  }

  const payload = await response.json();
  const data = payload?.data ?? null;
  // console.log("getEmployeeProfileFromRigweda response:", data);

  if (!data) {
    return null;
  }

  return {
    id: data._id || data.id || data.employeeId || data.userId,
    raw: data,
  };
};
