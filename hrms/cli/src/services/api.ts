const API_BASE_URL = 'https://www.upanayahr.com/api';

type ApiResponse<T> = {
  success?: boolean;
  code?: number;
  message?: string;
  data?: T;
  error?: unknown;
};

const normalizeToken = (token: string) =>
  token.toLowerCase().startsWith('bearer') ? token : `Bearer ${token}`;

const getAuthHeader = (token: string | null): Record<string, string> => {
  if (!token) return {};
  return { Authorization: normalizeToken(token) };
};

const buildHeaders = (token: string | null) => ({
  'Content-Type': 'application/json',
  ...getAuthHeader(token),
});

const extractAuthToken = (headers: Headers) =>
  headers.get('authorization') || headers.get('Authorization');

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export const setUnauthorizedHandler = (handler: UnauthorizedHandler | null) => {
  unauthorizedHandler = handler;
};

const handleUnauthorized = (response: Response) => {
  if (response.status === 401) {
    unauthorizedHandler?.();
    return true;
  }
  return false;
};

const safeJson = async <T>(response: Response): Promise<ApiResponse<T>> => {
    try {
      return (await response.json()) as ApiResponse<T>;
    } catch {
      return {
        success: false,
        code: response.status,
        message: 'Invalid server response',
      };
    }
  };

export const postApiWithoutToken = async <T>(
  path: string,
  payload: Record<string, unknown>
) => {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await safeJson<T>(response);
    return {
      json,
      token: extractAuthToken(response.headers),
    };
  } catch {
    return {
      json: {
        success: false,
        code: 500,
        message: 'Unable to reach server',
      },
      token: null,
    };
  }
};

export const getApiWithToken = async <T>(path: string, token: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: buildHeaders(token),
    });
    if (handleUnauthorized(response)) {
      return {
        success: false,
        code: 401,
        message: 'Your session has expired. Please log in again.',
      } as ApiResponse<T>;
    }
    return await safeJson<T>(response);
  } catch {
    return {
      success: false,
      code: 500,
      message: 'Unable to reach server',
    } as ApiResponse<T>;
  }
};

export const postApiWithToken = async <T>(
  path: string,
  payload: Record<string, unknown>,
  token: string
) => {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(payload),
    });
    if (handleUnauthorized(response)) {
      return {
        success: false,
        code: 401,
        message: 'Your session has expired. Please log in again.',
      } as ApiResponse<T>;
    }
    return await safeJson<T>(response);
  } catch {
    return {
      success: false,
      code: 500,
      message: 'Unable to reach server',
    } as ApiResponse<T>;
  }
};

export const postApiWithTokenAndAuth = async <T>(
  path: string,
  payload: Record<string, unknown>,
  token: string
) => {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(token),
      body: JSON.stringify(payload),
    });
    if (handleUnauthorized(response)) {
      return {
        json: {
          success: false,
          code: 401,
          message: 'Your session has expired. Please log in again.',
        } as ApiResponse<T>,
        token: null,
      };
    }
    const json = await safeJson<T>(response);
    return {
      json,
      token: extractAuthToken(response.headers),
    };
  } catch {
    return {
      json: {
        success: false,
        code: 500,
        message: 'Unable to reach server',
      },
      token: null,
    };
  }
};

export const putApiWithToken = async <T>(
  path: string,
  payload: Record<string, unknown>,
  token: string
) => {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PUT',
      headers: buildHeaders(token),
      body: JSON.stringify(payload),
    });
    if (handleUnauthorized(response)) {
      return {
        success: false,
        code: 401,
        message: 'Your session has expired. Please log in again.',
      } as ApiResponse<T>;
    }
    return await safeJson<T>(response);
  } catch {
    return {
      success: false,
      code: 500,
      message: 'Unable to reach server',
    } as ApiResponse<T>;
  }
};

export const patchApiWithToken = async <T>(
  path: string,
  payload: Record<string, unknown>,
  token: string
) => {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeader(token),
      },
      body: JSON.stringify(payload),
    });
    if (handleUnauthorized(response)) {
      return {
        success: false,
        code: 401,
        message: 'Your session has expired. Please log in again.',
      } as ApiResponse<T>;
    }
    return await safeJson<T>(response);
  } catch {
    return {
      success: false,
      code: 500,
      message: 'Unable to reach server',
    } as ApiResponse<T>;
  }
};
