import { getApiWithToken, patchApiWithToken, postApiWithToken } from "./apiWrapper";

export type MonitorRelease = {
  _id: string;
  version: string;
  build: number;
  channel: string;
  r2ObjectKey: string;
  sha256: string;
  fileSize: number;
  mandatory: boolean;
  status: "draft" | "testing" | "active" | "disabled";
  rolloutPercentage: number;
  minimumSupportedVersion?: string;
  releasedAt?: string | null;
  signedDownloadUrl?: string | null;
};

export type CreateMonitorReleasePayload = {
  version: string;
  build: number;
  channel?: string;
  mandatory?: boolean;
  status?: MonitorRelease["status"];
  rolloutPercentage?: number;
  minimumSupportedVersion?: string;
  releasedAt?: string;
  fileName?: string;
  fileBase64?: string;
};

export async function getMonitorReleases() {
  const response = await getApiWithToken("/monitor/releases", null, { suppressPermissionError: true });
  return (response?.data?.data || []) as MonitorRelease[];
}

export async function createMonitorRelease(payload: CreateMonitorReleasePayload) {
  const response = await postApiWithToken("/monitor/releases", payload);
  return response?.data?.data as MonitorRelease;
}

export async function updateMonitorRelease(releaseId: string, payload: Partial<Pick<CreateMonitorReleasePayload, "status" | "rolloutPercentage">>) {
  const response = await patchApiWithToken(`/monitor/releases/${releaseId}`, payload);
  return response?.data?.data as MonitorRelease;
}
