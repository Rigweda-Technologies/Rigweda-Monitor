import axios, { AxiosError, AxiosHeaderValue, AxiosResponse, RawAxiosRequestHeaders } from "axios";
import { toast } from "sonner";
import { getToken, setToken, hasAnyPermission, clearAuth } from "../utils/auth";
import { setOrgTimeZone } from "../utils/timezone";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
});

let sessionExpiryHandled = false;

export type ApiResponseEnvelope<TData = unknown> = {
  success?: boolean;
  code?: number;
  message?: string;
  data?: TData;
  skipped?: boolean;
};

type PermissionOptions = {
  requiredPermissions?: string[];
  suppressPermissionError?: boolean;
  cacheTtlMs?: number;
  forceRefresh?: boolean;
};
type RequestHeaders = RawAxiosRequestHeaders | null;
type CachedResponse = ApiResponseEnvelope<unknown>;

const inflightGetRequests = new Map<string, Promise<CachedResponse>>();
const recentGetResponses = new Map<string, { expiresAt: number; data: CachedResponse }>();
const RECENT_GET_TTL_MS = 1500;
const MASTER_DATA_GET_TTL_MS = 5 * 60 * 1000;
const EMPLOYEE_LOOKUP_GET_TTL_MS = 60 * 1000;

const getDefaultGetCacheTtl = (apiUrl: string) => {
  const parsedUrl = new URL(apiUrl, "http://upanaya.local");
  const masterDataPaths = new Set([
    "/departments",
    "/designations",
    "/roles",
    "/shifts",
    "/approval-flows",
    "/org-settings",
    "/organizations",
    "/payroll/pay-groups",
    "/payroll/settings"
  ]);

  if (masterDataPaths.has(parsedUrl.pathname)) {
    return MASTER_DATA_GET_TTL_MS;
  }

  // Employee dropdowns/managers omit pagination. Paginated employee tables stay fresh.
  if (
    parsedUrl.pathname === "/employees" &&
    !parsedUrl.searchParams.has("page") &&
    !parsedUrl.searchParams.has("limit") &&
    !parsedUrl.searchParams.has("search")
  ) {
    return EMPLOYEE_LOOKUP_GET_TTL_MS;
  }

  return RECENT_GET_TTL_MS;
};

const getRequestCacheKey = (apiUrl: string, headers: RawAxiosRequestHeaders = {}) =>
  JSON.stringify({
    apiUrl,
    headers: Object.keys(headers)
      .filter((key) => {
        const normalizedKey = key.toLowerCase();
        return (
          normalizedKey !== "content-type" &&
          normalizedKey !== "x-suppress-permission-error"
        );
      })
      .sort()
      .reduce((acc, key) => {
        const value = headers[key];
        acc[key] = value == null ? undefined : String(value);
        return acc;
      }, {} as Record<string, string | undefined>)
  });

const getInvalidationPrefixes = (apiUrl: string) => {
  const pathname = new URL(apiUrl, "http://upanaya.local").pathname;
  const segments = pathname.split("/").filter(Boolean);
  const resourcePrefix =
    segments[0] === "payroll" && segments[1]
      ? `/payroll/${segments[1]}`
      : segments[0]
        ? `/${segments[0]}`
        : pathname;
  const relatedPrefixes: Record<string, string[]> = {
    "/departments": ["/departments", "/designations"],
    "/designations": ["/designations"],
    "/roles": ["/roles", "/employees"],
    "/shifts": ["/shifts", "/employees"],
    "/approval-flows": ["/approval-flows", "/employees"],
    "/org-settings": ["/org-settings"],
    "/employees": ["/employees"],
    "/payroll/pay-groups": [
      "/payroll/pay-groups",
      "/payroll/salary-components",
      "/payroll/settings"
    ],
    "/payroll/salary-components": ["/payroll/salary-components"],
    "/payroll/settings": ["/payroll/settings"]
  };
  return relatedPrefixes[resourcePrefix] || [resourcePrefix];
};

const cacheKeyMatchesPrefixes = (cacheKey: string, prefixes: string[]) => {
  try {
    const parsed = JSON.parse(cacheKey) as { apiUrl?: string };
    const pathname = new URL(parsed.apiUrl || "", "http://upanaya.local").pathname;
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  } catch {
    return true;
  }
};

const clearGetCaches = (changedApiUrl?: string) => {
  if (!changedApiUrl) {
    inflightGetRequests.clear();
    recentGetResponses.clear();
    return;
  }

  const prefixes = getInvalidationPrefixes(changedApiUrl);
  for (const cacheKey of inflightGetRequests.keys()) {
    if (cacheKeyMatchesPrefixes(cacheKey, prefixes)) inflightGetRequests.delete(cacheKey);
  }
  for (const cacheKey of recentGetResponses.keys()) {
    if (cacheKeyMatchesPrefixes(cacheKey, prefixes)) recentGetResponses.delete(cacheKey);
  }
};

const readRecentGetResponse = (cacheKey: string) => {
  const cached = recentGetResponses.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    recentGetResponses.delete(cacheKey);
    return null;
  }
  return cached.data;
};

const rememberRecentGetResponse = (
  cacheKey: string,
  data: CachedResponse,
  ttlMs = RECENT_GET_TTL_MS
) => {
  recentGetResponses.set(cacheKey, {
    data,
    expiresAt: Date.now() + ttlMs
  });
};

const syncOrgTimeZoneFromResponse = (response: AxiosResponse<ApiResponseEnvelope<{ timezone?: string; orgSettings?: { timezone?: string } }>>) => {
  const data = response?.data?.data;
  const timeZone = data?.timezone || data?.orgSettings?.timezone;
  if (typeof timeZone === "string" && timeZone) {
    setOrgTimeZone(timeZone);
  }
};

const getHeaders = (headers: RequestHeaders): RawAxiosRequestHeaders =>
  headers ? { ...headers } : { "Content-Type": "application/json" as AxiosHeaderValue };

const permissionDeniedResponse = (): ApiResponseEnvelope<null> => ({
  success: false,
  code: 403,
  message: "Permission denied",
  skipped: true,
  data: null
});

const normalizeApiError = (error: unknown): ApiResponseEnvelope<unknown> => {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiResponseEnvelope<unknown>>;
    return axiosError.response?.data || { code: 500, message: axiosError.message || "Unknown error occurred" };
  }
  if (error && typeof error === "object") {
    return error as ApiResponseEnvelope<unknown>;
  }
  return { code: 500, message: "Unknown error occurred" };
};
/* ================= REQUEST ================= */
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = token.includes("Bearer") ? token : `Bearer ${token}`;
  }
  return config;
});

/* ================= RESPONSE ================= */
api.interceptors.response.use(
  (response) => {
    // ✅ Capture token from ANY response (login / switch-role)
    const authHeader = response.headers?.authorization;
    if (authHeader) {
      setToken(authHeader);
    }
    syncOrgTimeZoneFromResponse(response);
    return response;
  },
  (error) => {
    const status = error?.response?.status;
    const requestUrl = error?.config?.url || "";

    if (status === 403) {
      const suppressPermissionError = error?.config?.headers?.["x-suppress-permission-error"] === "true";
      if (!suppressPermissionError) {
        toast.error("You do not have access");
      }
      // window.location.href = "/no-access";
    }

    if (
      status === 401 &&
      getToken() &&
      !requestUrl.includes("/users/login") &&
      !sessionExpiryHandled
    ) {
      sessionExpiryHandled = true;
      toast.error("Session expired. Please login again");
      clearGetCaches();
      clearAuth();
      if (window.location.pathname !== "/login") {
        window.location.replace("/login?reason=session_expired");
      } else {
        sessionExpiryHandled = false;
      }
    }

    return Promise.reject(error);
  }
);
/* ================================
   API FUNCTIONS (UNCHANGED NAMES)
================================ */

// User registration
export const registerUser = async <TResponse = unknown, TPayload = unknown>(formData: TPayload) => {
  const response = await api.post("/users/register-lender", formData);
  return response as AxiosResponse<TResponse>;
};

// Login
export const LoginUser = async <TResponse = unknown, TPayload = unknown>(values: TPayload) => {
  const response = await api.post<TResponse>("/users/login", values);
  clearGetCaches();
  return response.data;
};

// POST without token
export const postApiWithoutToken = async <TResponse = unknown, TPayload = unknown>(
  apiUrl: string,
  params: TPayload
) => {
  try {
    const response = await api.post<TResponse>(apiUrl, params, {
      headers: {
        "Content-Type": "application/json",
      },
    });
    clearGetCaches(apiUrl);
    return response.data;
  } catch (error) {
    return normalizeApiError(error) as TResponse;
  }
};

// POST with token
export const postApiWithToken = async (
  apiUrl: string,
  params: unknown,
  _headers: RequestHeaders = null,
  options: PermissionOptions = {}
) => {
  try {
    if (options.requiredPermissions && !hasAnyPermission(options.requiredPermissions)) {
      return permissionDeniedResponse();
    }
    const headers = getHeaders(_headers);
    if (options.suppressPermissionError) {
      headers["x-suppress-permission-error"] = "true";
    }

    const response = await api.post(apiUrl, params, { headers });
    clearGetCaches(apiUrl);
    return response.data;
  } catch (error) {
    return normalizeApiError(error);
  }
};

// GET with token
export const getApiWithToken = async (
  apiUrl: string,
  _headers: RequestHeaders = null,
  options: PermissionOptions = {}
) => {
  try {
    if (options.requiredPermissions && !hasAnyPermission(options.requiredPermissions)) {
      return permissionDeniedResponse();
    }
    const headers = getHeaders(_headers);
    if (options.suppressPermissionError) {
      headers["x-suppress-permission-error"] = "true";
    }
    const cacheKey = getRequestCacheKey(apiUrl, headers);
    const cacheTtlMs = options.cacheTtlMs ?? getDefaultGetCacheTtl(apiUrl);
    if (!options.forceRefresh) {
      const cachedResponse = readRecentGetResponse(cacheKey);
      if (cachedResponse !== null) {
        return cachedResponse;
      }
    }
    const existingRequest = inflightGetRequests.get(cacheKey);
    if (existingRequest) {
      return existingRequest;
    }

    const requestPromise = api
      .get(apiUrl, { headers })
      .then((response) => {
        rememberRecentGetResponse(cacheKey, response.data, cacheTtlMs);
        return response.data;
      })
      .catch((error) => normalizeApiError(error))
      .finally(() => {
        inflightGetRequests.delete(cacheKey);
      });

    inflightGetRequests.set(cacheKey, requestPromise);
    return requestPromise;
  } catch (error) {
    return normalizeApiError(error);
  }
};

export const putApiWithToken = async (
  apiUrl: string,
  params: unknown,
  _headers: RequestHeaders = null,
  options: PermissionOptions = {}
) => {
  try {
    if (options.requiredPermissions && !hasAnyPermission(options.requiredPermissions)) {
      return permissionDeniedResponse();
    }
    const headers = getHeaders(_headers);
    if (options.suppressPermissionError) {
      headers["x-suppress-permission-error"] = "true";
    }
    const response = await api.put(apiUrl, params, { headers });
    clearGetCaches(apiUrl);
    return response.data;
  } catch (error) {
    return normalizeApiError(error);
  }     
};

export const patchApiWithToken = async (
  apiUrl: string,
  params: unknown = {},
  _headers: RequestHeaders = null,
  options: PermissionOptions = {}
) => {
  try {
    if (options.requiredPermissions && !hasAnyPermission(options.requiredPermissions)) {
      return permissionDeniedResponse();
    }
    const headers = getHeaders(_headers);
    const response = await api.patch(apiUrl, params, { headers });
    clearGetCaches(apiUrl);
    return response.data;
  } catch (error) {
    return normalizeApiError(error);
  }
};


// GET without token
export const getApiWithOutToken = async (apiUrl: string) => {
  try {
    const headers = { "Content-Type": "application/json" };
    const cacheKey = getRequestCacheKey(apiUrl, headers);
    const cachedResponse = readRecentGetResponse(cacheKey);
    if (cachedResponse !== null) {
      return cachedResponse;
    }
    const existingRequest = inflightGetRequests.get(cacheKey);
    if (existingRequest) {
      return existingRequest;
    }

    const requestPromise = api
      .get(apiUrl, { headers })
      .then((response) => {
        rememberRecentGetResponse(cacheKey, response.data);
        return response.data;
      })
      .catch((error) => normalizeApiError(error))
      .finally(() => {
        inflightGetRequests.delete(cacheKey);
      });

    inflightGetRequests.set(cacheKey, requestPromise);
    return requestPromise;
  } catch (error) {
    return normalizeApiError(error);
  }
};

// DELETE with token
export const deleteApiWithToken = async (apiUrl: string) => {
  try { 
    const response = await api.delete(apiUrl, {
      headers: { "Content-Type": "application/json" },
    });
    clearGetCaches(apiUrl);
    return response.data;
  } catch (error) {
    return normalizeApiError(error);
  }
};
/* ================================
   CONFIG EXPORTS (UNCHANGED)
================================ */

const config = {
  googlePlacesApiKey: import.meta.env.VITE_GOOGLE_PLACES_API_KEY || "",
};

export default config;

export const mapboxConfig = {
  accessToken: import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || "",
};

/* ================================
   UTIL (UNCHANGED)
================================ */

export function parseLocalISO(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const clean = iso.replace(/\.\d+Z?$/, "").replace(/Z$/, "");
  const [datePart, timePart] = clean.split("T");
  if (!datePart || !timePart) return null;
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm, ss] = timePart.split(":").map(Number);
  if ([y, m, d, hh, mm].some((v) => Number.isNaN(v))) return null;
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0);
}

// placeholder (safe)
export const switchRole = async (roleId: number) => {
  const response = await api.post("/roles/switch", { roleId });
  clearGetCaches();
  return response.data;
};
