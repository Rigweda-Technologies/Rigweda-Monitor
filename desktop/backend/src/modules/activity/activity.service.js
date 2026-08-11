import { getEmployeeProfileFromRigweda } from "../../integrations/rigweda-api.js";
import { activityModel } from "./activity.model.js";

const getEmployeeName = (profile) => {
  const raw = profile?.raw || {};
  return [raw.firstName, raw.lastName].filter(Boolean).join(" ") || raw.name || raw.email || null;
};

export const activityService = {
  async recordEvents({ auth, events }) {
    const profile = await getEmployeeProfileFromRigweda({ token: auth.token });
    const employeeId = profile?.employeeDbId || profile?.employeeId || profile?.userId || auth.userId;
    if (!employeeId) {
      const error = new Error("Employee profile not found for the authenticated user.");
      error.statusCode = 404;
      throw error;
    }
    return activityModel.saveEvents({
      organizationId: profile?.organizationId || auth.organizationId,
      employeeId: String(employeeId),
      employeeName: getEmployeeName(profile),
      events,
    });
  },

  async listEmployees({ auth, date }) {
    return activityModel.listEmployees({ organizationId: auth.organizationId, date });
  },
};
